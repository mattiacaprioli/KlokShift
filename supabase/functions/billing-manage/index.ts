// Edge Function `billing-manage` — gestione dell'abbonamento dalla pagina Piano.
//
// Azioni del titolare (utente dal JWT, mai dal body; autorizzazione in SQL):
//   - `portal`: sessione del portale clienti Paddle (carta, ricevute, disdetta);
//   - `resume_renewals`: toglie una disdetta o pausa programmata;
//   - `preview_change` / `apply_change`: aumento di piano o sedi, con l'importo
//     proporzionale calcolato da Paddle prima della conferma;
//   - `preview_scheduled_change` / `schedule_change` / `cancel_scheduled_change`:
//     riduzione di piano o sedi e cambio mensile↔annuale, programmati al
//     prossimo rinnovo (nessun addebito adesso; l'invio a Paddle lo fa il job);
//   - `pause`: ferma i rinnovi alla fine del periodo pagato (pausa stagionale);
//   - `resume`: riparte da una pausa con un periodo nuovo, addebitato subito;
//   - `cancel`: disdetta a fine periodo pagato, dopo la conferma della pagina.
//
// Questa funzione **non concede nulla**: piano e capacità cambiano solo quando
// arriva l'avviso firmato a `paddle-webhook`. Con `on_payment_failure:
// prevent_change` un aumento non pagato non viene applicato da Paddle.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy billing-manage --project-ref rmlobxjlqlpixkvrzmfg
// Variabili: le stesse di `billing-checkout` (PADDLE_API_KEY, PADDLE_ENVIRONMENT).

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import {
  buildItems,
  buildScheduledItems,
  changeBody,
  currentItems,
  dbError,
  lifecycleRequest,
  paddleConfig,
  parsePreparedChange,
  parsePreparedScheduledChange,
  parseRequest,
  portalLinks,
  previewSummary,
  renewalMatches,
  scheduledPreviewBody,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PADDLE = paddleConfig({
  environment: Deno.env.get("PADDLE_ENVIRONMENT"),
  apiKey: Deno.env.get("PADDLE_API_KEY"),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // Vedi `delete-account`: senza `apikey` e `x-client-info` il browser blocca
  // la POST dopo un preflight riuscito.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Chiamata a Paddle; nei log solo lo stato HTTP, mai il corpo. */
async function paddle(method: string, path: string, body?: unknown) {
  try {
    const response = await fetch(`${PADDLE!.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${PADDLE!.apiKey}`,
        "Content-Type": "application/json",
        "Paddle-Version": "1",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) console.error(`billing-manage: Paddle ${method} ${path.split("/")[1]}`, response.status);
    return { ok: response.ok, status: response.status, data };
  } catch {
    console.error("billing-manage: Paddle non raggiungibile");
    return { ok: false, status: 0, data: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!PADDLE) {
    console.error("billing-manage: configurazione Paddle mancante o incoerente");
    return json({ error: "billing_unavailable" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not_authenticated" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "billing_invalid_selection" }, 400);
  }
  const request = parseRequest(body);
  if (!request) return json({ error: "billing_invalid_selection" }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (request.action === "portal" || request.action === "resume_renewals") {
    const { data, error } = await admin.rpc("billing_manage_context", {
      p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
    });
    if (error) {
      const failure = dbError(error.message);
      if (failure.status === 500) console.error("billing-manage: context", error.code ?? "unknown");
      return json({ error: failure.code }, failure.status);
    }
    const context = data as { subscription_id: string; customer_id: string; scheduled_change: string | null };

    if (request.action === "portal") {
      const result = await paddle("POST", `/customers/${context.customer_id}/portal-sessions`,
        { subscription_ids: [context.subscription_id] });
      const links = result.ok ? portalLinks(result.data, context.subscription_id) : null;
      return links ? json(links) : json({ error: "billing_unavailable" }, 502);
    }

    if (context.scheduled_change === null) return json({ error: "billing_nothing_scheduled" }, 409);
    const result = await paddle("PATCH", `/subscriptions/${context.subscription_id}`, { scheduled_change: null });
    return result.ok ? json({ ok: true }) : json({ error: "billing_unavailable" }, 502);
  }

  if (request.action === "pause" || request.action === "resume" || request.action === "cancel") {
    const { data, error } = await admin.rpc("billing_prepare_lifecycle", {
      p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
      p_action: request.action,
    });
    if (error) {
      const failure = dbError(error.message);
      if (failure.status === 500) console.error("billing-manage: lifecycle", error.code ?? "unknown");
      return json({ error: failure.code }, failure.status);
    }
    const subscriptionId = (data as { subscription_id?: unknown } | null)?.subscription_id;
    if (typeof subscriptionId !== "string" || !/^sub_[a-z0-9]+$/.test(subscriptionId)) {
      console.error("billing-manage: risposta di lifecycle non valida");
      return json({ error: "manage_failed" }, 500);
    }
    const call = lifecycleRequest(request.action, subscriptionId);
    const result = await paddle("POST", call.path, call.body);
    if (!result.ok) {
      const code = (result.data as { error?: { code?: unknown } } | null)?.error?.code;
      return typeof code === "string" && /payment|declined|card/.test(code)
        ? json({ error: "billing_payment_failed" }, 402)
        : json({ error: "billing_unavailable" }, 502);
    }
    return json({ ok: true });
  }

  if (request.action === "cancel_scheduled_change") {
    const { error } = await admin.rpc("billing_cancel_scheduled_change", {
      p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
    });
    if (error) {
      const failure = dbError(error.message);
      if (failure.status === 500) console.error("billing-manage: cancel scheduled", error.code ?? "unknown");
      return json({ error: failure.code }, failure.status);
    }
    return json({ ok: true });
  }

  if (request.action === "preview_scheduled_change" || request.action === "schedule_change") {
    const { data: prepared, error: prepareErr } = await admin.rpc("billing_prepare_scheduled_change", {
      p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
      p_plan: request.plan, p_interval: request.interval, p_extra_venues: request.extraVenues,
    });
    if (prepareErr) {
      const failure = dbError(prepareErr.message);
      if (failure.status === 500) console.error("billing-manage: prepare scheduled", prepareErr.code ?? "unknown");
      return json({ error: failure.code }, failure.status);
    }
    const scheduled = parsePreparedScheduledChange(prepared);
    if (!scheduled) {
      console.error("billing-manage: risposta di prepare scheduled non valida");
      return json({ error: "manage_failed" }, 500);
    }

    const current = await paddle("GET", `/subscriptions/${scheduled.subscriptionId}`);
    const currentData = current.ok
      ? (current.data as { data?: { items?: unknown; next_billed_at?: unknown } } | null)?.data
      : null;
    // Il rinnovo su cui il database ha deciso deve essere quello di Paddle.
    if (!currentData || !renewalMatches(currentData.next_billed_at, scheduled.effectiveAt)) {
      return json({ error: "billing_unavailable" }, 502);
    }
    const fromItems = currentItems(currentData.items);
    const targetItems = buildScheduledItems(currentData.items, scheduled);
    if (!fromItems || !targetItems) return json({ error: "billing_unavailable" }, 502);

    const preview = await paddle("PATCH", `/subscriptions/${scheduled.subscriptionId}/preview`,
      scheduledPreviewBody(targetItems));
    const summary = preview.ok ? previewSummary(preview.data) : null;
    // Un cambio a rinnovo non deve muovere denaro adesso.
    if (!summary || summary.dueNowCents !== 0) return json({ error: "billing_unavailable" }, 502);

    if (request.action === "preview_scheduled_change") {
      return json({ currency: summary.currency, renewalCents: summary.renewalCents, effectiveAt: scheduled.effectiveAt });
    }
    if (summary.renewalCents !== request.expectedRenewalCents) return json({ error: "billing_amount_changed" }, 409);
    const { error: recordErr } = await admin.rpc("billing_record_scheduled_change", {
      p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
      p_plan: request.plan, p_interval: request.interval, p_extra_venues: request.extraVenues,
      p_from_items: fromItems, p_target_items: targetItems,
      p_renewal_cents: summary.renewalCents, p_currency: summary.currency,
    });
    if (recordErr) {
      const failure = dbError(recordErr.message);
      if (failure.status === 500) console.error("billing-manage: record scheduled", recordErr.code ?? "unknown");
      return json({ error: failure.code }, failure.status);
    }
    return json({ ok: true });
  }

  // Aumento di piano o sedi.
  const { data: prepared, error: prepareErr } = await admin.rpc("billing_prepare_change", {
    p_environment: PADDLE.environment, p_user: userData.user.id, p_workspace: request.workspaceId,
    p_plan: request.plan, p_extra_venues: request.extraVenues,
  });
  if (prepareErr) {
    const failure = dbError(prepareErr.message);
    if (failure.status === 500) console.error("billing-manage: prepare", prepareErr.code ?? "unknown");
    return json({ error: failure.code }, failure.status);
  }
  const change = parsePreparedChange(prepared);
  if (!change) {
    console.error("billing-manage: risposta di prepare non valida");
    return json({ error: "manage_failed" }, 500);
  }

  // Gli articoli attuali li dice Paddle: il registro locale potrebbe essere indietro di un avviso.
  const current = await paddle("GET", `/subscriptions/${change.subscriptionId}`);
  const items = current.ok
    ? buildItems((current.data as { data?: { items?: unknown } } | null)?.data?.items, change)
    : null;
  if (!items) return json({ error: "billing_unavailable" }, 502);

  const path = `/subscriptions/${change.subscriptionId}${request.action === "preview_change" ? "/preview" : ""}`;
  const result = await paddle("PATCH", path, changeBody(items));
  if (!result.ok) {
    // Con prevent_change un addebito rifiutato lascia l'abbonamento com'era.
    const code = (result.data as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === "string" && /payment|declined|card/.test(code)
      ? json({ error: "billing_payment_failed" }, 402)
      : json({ error: "billing_unavailable" }, 502);
  }
  if (request.action === "apply_change") return json({ ok: true });
  const summary = previewSummary(result.data);
  return summary ? json(summary) : json({ error: "billing_unavailable" }, 502);
});
