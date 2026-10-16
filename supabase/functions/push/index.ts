// Edge Function `push` — invia le push OS via Expo Push API.
// Chiamata dal trigger public.notify_push_on_notification (pg_net) ad ogni riga
// inserita in public.notifications. Auth = secret condiviso nell'header
// x-push-secret (deploy con --no-verify-jwt). Usa il service_role per leggere i
// token (bypassa la RLS "own only") e rimuove i token DeviceNotRegistered.
//
// Deploy:
//   supabase secrets set PUSH_HOOK_SECRET=<random>   (+ opz. EXPO_ACCESS_TOKEN)
//   supabase functions deploy push --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { Expo, type ExpoPushMessage } from "npm:expo-server-sdk@7.2.0";

type NotificationPayload = {
  notification_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  related_id: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET");
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const expo = new Expo(
  EXPO_ACCESS_TOKEN ? { accessToken: EXPO_ACCESS_TOKEN } : undefined
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Auth: secret condiviso col trigger. Senza secret configurato → nessun accesso.
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!payload?.user_id) return json({ error: "missing user_id" }, 400);

  // Token del destinatario (service_role → bypassa RLS).
  const { data: rows, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", payload.user_id);
  if (error) {
    console.error("push_tokens_failed", error.code);
    return json({ error: "push_tokens_failed" }, 500);
  }

  const tokens = (rows ?? [])
    .map((r) => r.token as string)
    .filter((t) => Expo.isExpoPushToken(t));
  if (tokens.length === 0) return json({ sent: 0 });

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: {
      type: payload.type,
      related_id: payload.related_id,
      notification_id: payload.notification_id,
    },
  }));

  const deadTokens: string[] = [];
  let sent = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status === "ok") {
          sent += 1;
          return;
        }
        // Il messaggio del provider può contenere il token: registra solo il codice.
        console.error("expo_push_ticket_failed", ticket.details?.error ?? "unknown");
        if (ticket.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[i].to as string);
        }
      });
    } catch {
      console.error("expo_push_send_failed");
    }
  }

  // Cleanup dei token non più validi (disinstallazione / permesso revocato).
  let removed = 0;
  if (deadTokens.length > 0) {
    try {
      const { data, error } = await supabase.from("push_tokens").delete().in("token", deadTokens).select("token");
      if (error) {
        console.error("push_token_cleanup_failed", error.code);
      } else {
        removed = data?.length ?? 0;
      }
    } catch {
      console.error("push_token_cleanup_failed");
    }
  }

  // Un ticket ok conferma l'accettazione da Expo, non la consegna al dispositivo.
  return json({ sent, removed });
});
