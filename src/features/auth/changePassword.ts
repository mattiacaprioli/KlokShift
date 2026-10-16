import type { SupabaseClient, User } from "@supabase/supabase-js";
import { passwordUnchangedMessage } from "./schema";

/**
 * Cambio password da loggati, senza React né client globale: riceve il client
 * auth come parametro, così la sequenza si prova nei test. La usano
 * `changePassword` in `lib/auth.tsx` e quindi app e dashboard insieme.
 */
export type ChangePasswordAuth = Pick<
  SupabaseClient["auth"],
  "signInWithPassword" | "updateUser" | "signOut"
> & {
  mfa: Pick<SupabaseClient["auth"]["mfa"], "listFactors" | "challengeAndVerify">;
};

/**
 * `codeRequired`: l'account ha il secondo fattore e il codice manca o è
 * sbagliato. La dashboard mostra il campo; l'app rimanda alla dashboard.
 */
export type ChangePasswordResult = {
  error: string | null;
  warning?: string;
  codeRequired?: boolean;
};

/**
 * L'account ha un'app di autenticazione verificata? Dal `user` della sessione,
 * senza rete: serve solo a decidere cosa mostrare prima dell'invio. Il
 * controllo che conta lo rifà `runChangePassword` con `listFactors`.
 */
export function hasVerifiedTotp(user: Pick<User, "factors"> | null | undefined): boolean {
  return (user?.factors ?? []).some(
    (f) => f.factor_type === "totp" && f.status === "verified"
  );
}

export const CODE_REQUIRED_MESSAGE =
  "Inserisci il codice a 6 cifre dell'app di autenticazione.";
export const CODE_INVALID_MESSAGE =
  "Codice non valido o scaduto. Controlla l'app di autenticazione e riprova.";
export const FACTORS_UNAVAILABLE_MESSAGE =
  "Non riusciamo a verificare il secondo fattore dell'account. Riprova.";

/** Il cambio è riuscito ma le altre sessioni no: un avviso, non un errore. */
export const OTHER_SESSIONS_WARNING =
  "Password cambiata, ma non siamo riusciti a disconnettere gli altri dispositivi. Riprova da Impostazioni o contattaci.";

export async function runChangePassword(
  auth: ChangePasswordAuth,
  email: string,
  current: string,
  next: string,
  code?: string
): Promise<ChangePasswordResult> {
  // La verifica è un accesso vero e proprio: GoTrue non ha un «controlla la
  // password» a parte, e così vale anche il suo limite ai tentativi. Il
  // SIGNED_IN che ne nasce è della stessa persona, quindi non svuota la
  // cache e non fa ricaricare l'app (vedi `silent` nel listener).
  const check = await auth.signInWithPassword({ email, password: current });
  if (check.error) {
    const wrong =
      check.error.code === "invalid_credentials" ||
      check.error.message.toLowerCase().includes("invalid login credentials");
    return {
      error: wrong
        ? "La password attuale non è corretta."
        : authErrorMessage(check.error.message, check.error.code),
    };
  }

  // Secondo fattore (D5, oggi solo l'account del fondatore). L'accesso qui
  // sopra ha prodotto una sessione `aal1`: senza il codice la password di un
  // account protetto cambierebbe con la sola password vecchia. Il dato
  // mancante non sblocca: se i fattori non si leggono, ci si ferma.
  const factors = await auth.mfa.listFactors();
  if (factors.error) return { error: FACTORS_UNAVAILABLE_MESSAGE };
  const totp = factors.data.totp.find((f) => f.status === "verified");
  if (totp) {
    const trimmed = (code ?? "").replace(/\s+/g, "");
    if (!trimmed) return { error: CODE_REQUIRED_MESSAGE, codeRequired: true };
    if (!/^\d{6}$/.test(trimmed)) {
      return { error: CODE_INVALID_MESSAGE, codeRequired: true };
    }
    const verified = await auth.mfa.challengeAndVerify({
      factorId: totp.id,
      code: trimmed,
    });
    if (verified.error) return { error: CODE_INVALID_MESSAGE, codeRequired: true };
  }

  const { error } = await auth.updateUser({ password: next });
  if (error) return { error: authErrorMessage(error.message, error.code) };

  // La password è già cambiata: un errore qui non deve far credere il
  // contrario, ma va detto. ⚠️ `signOut` di auth-js **restituisce** `{ error }`
  // e di norma non lancia: ignorarne l'esito lasciava aperte, senza dirlo, le
  // sessioni di chi cambiava password proprio perché temeva un accesso altrui.
  // `others` lascia intatta la sessione corrente.
  try {
    const { error: outError } = await auth.signOut({ scope: "others" });
    if (outError) return { error: null, warning: OTHER_SESSIONS_WARNING };
  } catch {
    return { error: null, warning: OTHER_SESSIONS_WARNING };
  }
  return { error: null };
}

/**
 * Gli errori di GoTrue in italiano. Sta qui e non in `lib/auth.tsx` perché
 * questo modulo è puro e si testa; `auth.tsx` la riesporta.
 *
 * Prima il codice (`AuthError.code`), stabile; poi il testo, per i chiamanti
 * che passano solo il messaggio e per le versioni di GoTrue senza codice.
 */
export function authErrorMessage(message: string, code?: string): string {
  switch (code) {
    case "weak_password":
      return "Password troppo debole o già comparsa in una violazione: scegline un'altra.";
    case "same_password":
      return passwordUnchangedMessage;
    case "insufficient_aal":
    case "reauthentication_needed":
      return "Per cambiare password serve il codice di verifica. Esci, accedi di nuovo con il codice e riprova.";
  }
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email o password non corretti.";
  }
  if (m.includes("user already registered")) {
    return "Esiste già un account con questa email.";
  }
  if (m.includes("password should be at least")) {
    return "La password deve avere almeno 8 caratteri.";
  }
  if (m.includes("unable to validate email") || m.includes("invalid email")) {
    return "Inserisci un indirizzo email valido.";
  }
  if (m.includes("email not confirmed")) {
    return "Conferma la tua email prima di accedere.";
  }
  if (m.includes("different from the old password")) {
    return passwordUnchangedMessage;
  }
  // ⚠️ Due limiti diversi, e l'attesa non è la stessa. Il servizio email
  // integrato di Supabase manda **2 email all'ora per progetto**: chi ci
  // sbatte non è «uno che insiste», è il secondo utente che si registra
  // nella stessa ora. Dirgli «qualche minuto» lo fa solo riprovare a vuoto.
  // Si toglie configurando un SMTP proprio in Authentication → Emails.
  if (m.includes("email rate limit")) {
    return "Abbiamo mandato troppe email nell'ultima ora. Riprova più tardi.";
  }
  // Questo invece è il freno per singolo indirizzo ("For security purposes,
  // you can only request this after N seconds"): lì i minuti sono giusti.
  if (m.includes("rate limit") || m.includes("you can only request this")) {
    return "Troppi tentativi. Aspetta qualche minuto e riprova.";
  }
  return "Si è verificato un errore. Riprova.";
}
