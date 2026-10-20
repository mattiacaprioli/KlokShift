// Edge Function `archive-reminders` — email dei promemoria dell'archivio.
//
// La chiama ogni mattina `private.run_archive_reminders` (pg_cron → pg_net)
// dopo aver messo in coda i promemoria in `public.archive_reminders` e creato le
// notifiche nell'app. Qui si spediscono le email ancora da mandare, fino a 5
// tentativi per riga. Stesso Resend degli inviti (`invite-staff`).
//
// Nessun JWT: la chiama il database con il segreto delle push (header
// `x-push-secret`, Vault `push_hook_secret`). Senza segreto giusto non fa nulla.
//
// Deploy (chiamata dal database, quindi --no-verify-jwt):
//   supabase functions deploy archive-reminders --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
// Variabili: PUSH_HOOK_SECRET, SMTP_* e DASHBOARD_URL (le stesse di push e invite-staff).

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { parseReminder, runReminders, type Reminder } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET");
const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SMTP_FROM = Deno.env.get("SMTP_FROM");
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !DASHBOARD_URL) {
    console.error("archive-reminders: configurazione email mancante");
    return json({ error: "email_unavailable" }, 503);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      // Vedi `invite-staff`: 465 è TLS implicito.
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  try {
    const result = await runReminders({
      async listPending(limit) {
        const { data, error } = await admin.from("archive_reminders")
          .select("id,kind,archive_until,workspace_name,email,email_attempts")
          .is("emailed_at", null).lt("email_attempts", 5)
          .order("created_at", { ascending: true }).limit(limit);
        if (error) return null;
        return (data ?? []).map((row) => parseReminder(row)).filter((r): r is Reminder => r !== null);
      },
      async send(to, mail) {
        try {
          await client.send({ from: SMTP_FROM, to, subject: mail.subject, content: mail.text, html: mail.html });
          return true;
        } catch {
          // Mai il messaggio grezzo: contiene l'indirizzo del destinatario.
          console.error("archive-reminders: smtp_failed");
          return false;
        }
      },
      async markSent(id) {
        const { error } = await admin.from("archive_reminders").update({ emailed_at: new Date().toISOString() }).eq("id", id);
        return !error;
      },
      async markFailed(r) {
        const { error } = await admin.from("archive_reminders")
          .update({ email_attempts: r.attempts + 1, last_error_code: "smtp_failed" }).eq("id", r.id);
        return !error;
      },
    }, DASHBOARD_URL);
    if (result.error) console.error("archive-reminders:", result.error);
    return json(result);
  } finally {
    try { await client.close(); } catch { /* L'esito degli invii è già deciso. */ }
  }
});
