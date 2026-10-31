// Edge Function `billing-scheduled` — invio a Paddle dei cambi di piano
// programmati al rinnovo, ed email di promemoria e d'allarme.
//
// La chiama ogni 10 minuti `private.run_scheduled_billing_changes` (pg_cron →
// pg_net) quando c'è lavoro: cambi da inviare nelle 24 ore prima del rinnovo,
// promemoria da spedire al titolare, allarmi da spedire al fondatore.
//
// Per ogni cambio preso in carico (`billing_scheduled_claim`, che lo toglie
// dalla coda per 15 minuti): legge l'abbonamento da Paddle, controlla che
// rinnovo e articoli siano quelli della richiesta, fa la PATCH con gli articoli
// d'arrivo registrati (`do_not_bill`) e registra l'esito
// (`billing_scheduled_result`: applicato, da riprovare o fallito con allarme).
// Un cambio di ciclo (mensile↔annuale) fa ripartire il periodo su Paddle: una
// seconda PATCH rimette `next_billed_at` alla data d'effetto e una GET la
// verifica; se non torna si riprova con l'allarme `date_not_fixed`
// (docs/TEST-BILLING-SCHEDULED.md §3 bis). Se la data non si può più rimettere
// (PATCH rifiutata, periodo non ripartito dalla nostra PATCH) chiude con
// `paddle_date_not_fixed_final`: allarme al fondatore, nessun avviso al titolare.
// Questa funzione **non concede nulla**: piano e capacità cambiano solo con
// l'avviso firmato a `paddle-webhook`.
//
// Nessun JWT: la chiama il database con il segreto delle push (header
// `x-push-secret`, Vault `push_hook_secret`). Senza segreto giusto non fa nulla.
// Nei log solo codici: mai corpi di Paddle, indirizzi o nomi.
//
// Deploy (chiamata dal database, quindi --no-verify-jwt):
//   supabase functions deploy billing-scheduled --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
// Variabili: PUSH_HOOK_SECRET, PADDLE_API_KEY e PADDLE_ENVIRONMENT (quelle di
// `billing-manage`), SMTP_* e DASHBOARD_URL (quelle di `archive-reminders`),
// FOUNDER_ALERT_EMAIL (destinatario degli allarmi, mai scritto nel codice).

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import {
  paddleConfig,
  runScheduled,
  type QueuedEmail,
  type ScheduledChange,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET");
const PADDLE = paddleConfig({
  environment: Deno.env.get("PADDLE_ENVIRONMENT"),
  apiKey: Deno.env.get("PADDLE_API_KEY"),
});
const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SMTP_FROM = Deno.env.get("SMTP_FROM");
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");
const FOUNDER_ALERT_EMAIL = Deno.env.get("FOUNDER_ALERT_EMAIL");

const EMAIL_LIMIT = 50;
const COLUMNS = "id,subscription_id,workspace_id,requested_by,target_plan,target_interval,target_extra_venues," +
  "from_interval,from_items,target_items,renewal_cents,currency,effective_at,alert_kind,last_error_code," +
  "status,close_reason,reviewed_at,reminder_email_attempts,alert_email_attempts,workspace:workspaces(name)";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
    if (!response.ok) console.error(`billing-scheduled: Paddle ${method}`, response.status);
    return { ok: response.ok, status: response.status, data };
  } catch {
    console.error("billing-scheduled: Paddle non raggiungibile");
    return { ok: false, status: 0, data: null };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  // Senza Paddle i cambi restano in coda (a 6 ore dal rinnovo parte l'allarme);
  // senza email l'invio a Paddle va avanti lo stesso.
  const emailReady = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM && DASHBOARD_URL);
  if (!PADDLE) console.error("billing-scheduled: configurazione Paddle mancante o incoerente");
  if (!emailReady) console.error("billing-scheduled: configurazione email mancante");
  if (!PADDLE && !emailReady) return json({ error: "billing_unavailable" }, 503);
  if (emailReady && !FOUNDER_ALERT_EMAIL) console.error("billing-scheduled: FOUNDER_ALERT_EMAIL mancante");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const client = emailReady
    ? new SMTPClient({
      connection: {
        hostname: SMTP_HOST!,
        port: SMTP_PORT,
        // Vedi `invite-staff`: 465 è TLS implicito.
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER!, password: SMTP_PASS! },
      },
    })
    : null;

  /**
   * Le righe con un'email in attesa, con il nome dell'azienda. Le regole
   * (riga illeggibile, cambio chiuso, allarme già rivisto) le applica `runScheduled`.
   */
  async function pendingRows(kind: "reminder" | "alert"): Promise<QueuedEmail[] | null> {
    let query = admin.from("billing_scheduled_changes").select(COLUMNS);
    query = kind === "reminder"
      ? query.not("reminder_notified_at", "is", null).is("reminder_emailed_at", null).lt("reminder_email_attempts", 5)
      : query.not("alert_kind", "is", null).is("alert_emailed_at", null).lt("alert_email_attempts", 5);
    const { data, error } = await query.order("created_at", { ascending: true }).limit(EMAIL_LIMIT);
    if (error) return null;
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
      const name = (row.workspace as { name?: unknown } | null)?.name;
      return { row, workspaceName: typeof name === "string" ? name : null };
    });
  }

  /**
   * Un'email sola, a chi ha chiesto il cambio, se è ancora titolare attivo
   * con l'email confermata (come `archive_reminders`); la notifica nell'app
   * arriva comunque a tutti i titolari. Altrimenti null.
   */
  async function reminderRecipient(change: ScheduledChange): Promise<string | null | undefined> {
    const { data: member, error } = await admin.from("workspace_members").select("id")
      .eq("workspace_id", change.workspaceId).eq("user_id", change.requestedBy)
      .eq("authority", "owner").eq("status", "active").maybeSingle();
    if (error) return undefined;
    if (!member) return null;
    const { data: found, error: userErr } = await admin.auth.admin.getUserById(change.requestedBy);
    if (userErr) return userErr.status === 404 ? null : undefined;
    const user = found.user as { email?: string | null; email_confirmed_at?: string | null; deleted_at?: string | null } | null;
    return user && !user.deleted_at && user.email_confirmed_at && user.email ? user.email : null;
  }

  /**
   * Segna l'email come spedita o conta un tentativo. Per un allarme solo se è
   * ancora quello letto: se nel frattempo è cambiato (failed → renewal_mismatch)
   * il trigger ha già riaperto l'email per il motivo nuovo, e non va timbrata.
   */
  async function mark(kind: "reminder" | "alert", id: string, sent: boolean, attempts: number, alertKind?: string) {
    const patch = sent
      ? { [`${kind}_emailed_at`]: new Date().toISOString() }
      : { [`${kind}_email_attempts`]: attempts + 1 };
    let query = admin.from("billing_scheduled_changes").update(patch).eq("id", id);
    if (alertKind) query = query.eq("alert_kind", alertKind);
    const { error } = await query;
    return !error;
  }

  try {
    const result = await runScheduled({
      async claim() {
        if (!PADDLE) return [];
        const { data, error } = await admin.rpc("billing_scheduled_claim", { p_environment: PADDLE.environment, p_limit: 10 });
        if (error) return null;
        return Array.isArray(data) ? data as Record<string, unknown>[] : [];
      },
      async getSubscription(subscriptionId) {
        const { data, error } = await admin.from("billing_subscriptions").select("provider_subscription_id")
          .eq("id", subscriptionId).maybeSingle();
        const providerId = (data as { provider_subscription_id?: unknown } | null)?.provider_subscription_id;
        // Un problema di lettura nostro si riprova come Paddle non raggiungibile.
        if (error || typeof providerId !== "string") {
          console.error("billing-scheduled: subscription_lookup_failed");
          return { ok: false, status: 0 };
        }
        const read = await paddle("GET", `/subscriptions/${providerId}`);
        return read.ok
          ? { ok: true, providerId, subscription: (read.data as { data?: unknown } | null)?.data ?? null }
          : { ok: false, status: read.status };
      },
      async patchSubscription(providerId, body) {
        const write = await paddle("PATCH", `/subscriptions/${providerId}`, body);
        return write.ok ? { ok: true } : { ok: false, status: write.status };
      },
      async result(id, ok, error, permanent) {
        const { error: rpcErr } = await admin.rpc("billing_scheduled_result", {
          p_id: id, p_ok: ok, p_error: error, p_permanent: permanent,
        });
        if (rpcErr) console.error("billing-scheduled: result", rpcErr.code ?? "unknown");
        return !rpcErr;
      },
      listReminderEmails: () => emailReady ? pendingRows("reminder") : Promise.resolve([]),
      listAlertEmails: () => emailReady && FOUNDER_ALERT_EMAIL ? pendingRows("alert") : Promise.resolve([]),
      reminderRecipient,
      founderEmail: FOUNDER_ALERT_EMAIL ?? null,
      async send(to, mail) {
        try {
          await client!.send({ from: SMTP_FROM!, to, subject: mail.subject, content: mail.text, html: mail.html });
          return true;
        } catch {
          // Mai il messaggio grezzo: contiene l'indirizzo del destinatario.
          console.error("billing-scheduled: smtp_failed");
          return false;
        }
      },
      markReminder: (id, sent, attempts) => mark("reminder", id, sent, attempts),
      markAlert: (id, sent, attempts, kind) => mark("alert", id, sent, attempts, kind),
    }, DASHBOARD_URL);
    if (result.error) console.error("billing-scheduled:", result.error);
    return json(result);
  } finally {
    try { await client?.close(); } catch { /* L'esito degli invii è già deciso. */ }
  }
});
