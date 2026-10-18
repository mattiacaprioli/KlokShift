// Edge Function `paddle-webhook` — riceve gli avvisi di Paddle (Billing).
//
// È l'unica porta da cui un pagamento cambia i diritti di un'azienda: verifica
// la firma `Paddle-Signature` sul corpo grezzo e passa l'evento così com'è a
// `billing_apply_event`, che fa tutto il resto in SQL (idempotenza, ordine,
// collegamento all'azienda, periodi). Plans: MONETIZATION-AND-FOUNDER-DASHBOARD.md, M09.
//
// ⚠️ **Pubblica** (`--no-verify-jwt`): Paddle non ha un JWT. Senza segreto o
// ambiente configurati la funzione rifiuta tutto, non accetta per default.
//
// Risposte: 200 per ogni esito definitivo, anche uno scarto (l'evento resta nel
// registro con il motivo e ritentarlo non lo cambierebbe); 401 firma non valida;
// 500 errore imprevisto, che Paddle ritenterà. Paddle vuole la risposta entro
// 5 secondi: qui c'è una sola chiamata al database.
//
// Deploy:
//   supabase secrets set PADDLE_WEBHOOK_SECRET=<chiave della destinazione> PADDLE_ENVIRONMENT=sandbox
//   supabase functions deploy paddle-webhook --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { FINAL_OUTCOMES, isBillingEnvironment, verifyPaddleSignature } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "";
const ENVIRONMENT = Deno.env.get("PADDLE_ENVIRONMENT");

// Un avviso di Paddle pesa pochi KB: oltre questo è qualcos'altro.
const MAX_BODY_BYTES = 256 * 1024;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!WEBHOOK_SECRET || !isBillingEnvironment(ENVIRONMENT)) {
    console.error("paddle-webhook: PADDLE_WEBHOOK_SECRET o PADDLE_ENVIRONMENT mancanti");
    return json({ error: "not_configured" }, 500);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const valid = await verifyPaddleSignature(
    raw, req.headers.get("paddle-signature"), WEBHOOK_SECRET, Math.floor(Date.now() / 1000)
  );
  if (!valid) return json({ error: "invalid_signature" }, 401);

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return json({ error: "invalid_event" }, 400);
  }

  const { data, error } = await supabase.rpc("billing_apply_event", {
    p_environment: ENVIRONMENT,
    p_event: event,
  });
  if (error) {
    // Solo il codice: il messaggio del database può contenere dettagli interni.
    console.error("paddle-webhook: billing_apply_event", error.code ?? "unknown");
    return json({ error: "apply_failed" }, 500);
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (typeof outcome !== "string" || !(FINAL_OUTCOMES as readonly string[]).includes(outcome)) {
    console.error("paddle-webhook: esito inatteso");
    return json({ error: "apply_failed" }, 500);
  }
  if (outcome === "rejected") {
    // Un pagamento che non concede nulla è da guardare: resta in private.billing_events.
    const eventId = (event as { event_id?: unknown }).event_id;
    console.error("paddle-webhook: evento scartato", String(eventId),
      String((data as { error?: unknown }).error));
  }
  return json({ outcome });
});
