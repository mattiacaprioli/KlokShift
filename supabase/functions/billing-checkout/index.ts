// Edge Function `billing-checkout` — prepara un acquisto per la pagina Piano.
//
// Il titolare sceglie piano, periodo e sedi; qui si verifica chi è (dal JWT,
// mai dal body), `billing_prepare_checkout` decide se può comprare e con quali
// prezzi, e si crea su Paddle la transazione con `custom_data.klokshift_checkout`.
// La pagina apre poi il checkout di Paddle su quella transazione.
//
// Questa funzione **non concede nulla**: il diritto arriva solo dall'avviso
// firmato che Paddle manda a `paddle-webhook` dopo il pagamento.
// Prezzi e acquisto restano sul web: l'app nativa non chiama questa funzione.
//
// `{ "action": "client_config" }` risponde anche senza utente con ambiente e
// token client di Paddle: sono pubblici per natura (Paddle.js li espone nella
// pagina) e servono alla dashboard per aprire da sola il pagamento quando il
// cliente arriva dal link di un'email Paddle (`?_ptxn=txn_…`).
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase secrets set PADDLE_API_KEY=<chiave API> PADDLE_CLIENT_TOKEN=<token client> PADDLE_ENVIRONMENT=sandbox
//   supabase functions deploy billing-checkout --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import {
  isClientConfigRequest,
  paddleConfig,
  parsePrepared,
  parseSelection,
  prepareError,
  transactionBody,
  transactionId,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PADDLE = paddleConfig({
  environment: Deno.env.get("PADDLE_ENVIRONMENT"),
  apiKey: Deno.env.get("PADDLE_API_KEY"),
  clientToken: Deno.env.get("PADDLE_CLIENT_TOKEN"),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!PADDLE) {
    console.error("billing-checkout: configurazione Paddle mancante o incoerente");
    return json({ error: "billing_unavailable" }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "billing_invalid_selection" }, 400);
  }
  if (isClientConfigRequest(body)) {
    return json({ environment: PADDLE.environment, clientToken: PADDLE.clientToken });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not_authenticated" }, 401);

  const selection = parseSelection(body);
  if (!selection) return json({ error: "billing_invalid_selection" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: preparedData, error: prepareErr } = await admin.rpc("billing_prepare_checkout", {
    p_environment: PADDLE.environment,
    p_user: userData.user.id,
    p_workspace: selection.workspaceId,
    p_plan: selection.plan,
    p_interval: selection.interval,
    p_extra_venues: selection.extraVenues,
  });
  if (prepareErr) {
    const failure = prepareError(prepareErr.message);
    if (failure.status === 500) console.error("billing-checkout: prepare", prepareErr.code ?? "unknown");
    return json({ error: failure.code }, failure.status);
  }
  const prepared = parsePrepared(preparedData);
  if (!prepared) {
    console.error("billing-checkout: risposta di prepare non valida");
    return json({ error: "prepare_failed" }, 500);
  }

  let response: Response;
  try {
    response = await fetch(`${PADDLE.apiBase}/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PADDLE.apiKey}`,
        "Content-Type": "application/json",
        "Paddle-Version": "1",
      },
      body: JSON.stringify(transactionBody(prepared)),
    });
  } catch {
    console.error("billing-checkout: Paddle non raggiungibile");
    return json({ error: "billing_unavailable" }, 502);
  }
  const created = transactionId(await response.json().catch(() => null));
  if (!response.ok || !created) {
    // Solo lo stato HTTP: il corpo di Paddle può ripetere dati della richiesta.
    console.error("billing-checkout: creazione transazione", response.status);
    return json({ error: "billing_unavailable" }, 502);
  }

  const { error: attachErr } = await admin.rpc("billing_attach_checkout_transaction", {
    p_checkout: prepared.checkoutId,
    p_transaction_id: created,
  });
  // Il collegamento serve alla riconciliazione, non al diritto: il checkout
  // può proseguire, l'abbonamento si lega comunque tramite custom_data.
  if (attachErr) console.error("billing-checkout: attach", attachErr.code ?? "unknown");

  return json({
    transactionId: created,
    environment: PADDLE.environment,
    clientToken: PADDLE.clientToken,
    email: userData.user.email ?? null,
  });
});
