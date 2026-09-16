// Atterraggio dei link auth che arrivano per email.
//
// Uno solo passa da GoTrue: il recupero password (`type=recovery`), che rimanda
// qui con i token nel fragment (`#access_token=…&refresh_token=…&type=recovery`)
// oppure con un errore (`#error=…&error_code=otp_expired`).
//
// ⚠️ L'invito del collaboratore **non** passa di qui: porta un token nostro a
// `#/invito`, che è una rotta normale e non un fragment auth (vedi
// `pages/Invito.tsx`). Ci ha provato per un giorno, via `type=invite`, e quella
// strada creava l'account all'invio invece che all'accettazione.
//
// Il client web ha `detectSessionInUrl: false` — per la conferma email quei
// token non servono — quindi il caso recovery si gestisce a mano, PRIMA che
// HashRouter veda quel fragment: al primo `<Navigate>` il fragment viene
// riscritto e i token sono persi.

import { supabase } from "@/lib/supabase";

/**
 * Esito negativo passato all'accesso come `#/login?link=…`: nell'URL e non in
 * una variabile di modulo, così il messaggio sopravvive a un ricaricamento e
 * sparisce appena si va altrove. Anche il link di conferma email atterra qui
 * quando scade: i testi non nominano il recupero.
 */
export const LINK_ERRORS: Record<string, string> = {
  scaduto: "Il link è scaduto. Richiedine uno nuovo.",
  "non-valido": "Il link non è valido o è già stato usato. Richiedine uno nuovo.",
};

/** Da chiamare una volta, prima di montare l'app. */
export async function consumeAuthLink(): Promise<void> {
  // Una rotta normale ("#/storico", o "#/invito?t=…") non ha né `type` né
  // `error`: qui non si entra e il fragment resta intatto per il router.
  const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, ""));
  const isRecovery = params.get("type") === "recovery";
  const errorCode = params.get("error_code") ?? params.get("error");
  if (!isRecovery && !errorCode) return;

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (isRecovery && accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (!error) {
      // Sessione di recupero attiva: l'unica cosa da fare ora è la password.
      window.location.hash = "#/nuova-password";
      return;
    }
  }

  window.location.hash =
    errorCode === "otp_expired" ? "#/login?link=scaduto" : "#/login?link=non-valido";
}
