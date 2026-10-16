import type { AuthChangeEvent } from "@supabase/supabase-js";

/**
 * Cosa fa `AuthProvider` a ogni cambio di sessione, senza React né Supabase:
 * così le regole si provano nei test. Le applica `lib/auth.tsx` (listener di
 * `onAuthStateChange` e `syncSession`).
 *
 * ⚠️ Due regole da non perdere:
 * - la cache React Query si svuota a **ogni** cambio di persona, non solo al
 *   logout: le chiavi di contesto e sedi non contengono l'id dell'utente;
 * - nessun `await` di query Supabase dentro `onAuthStateChange` (deadlock di
 *   auth-js): il profilo si carica dopo, fuori dal callback.
 */
export type AuthEventPlan = {
  /** Svuotare la cache: la sessione nuova è di un'altra persona (o di nessuno). */
  clearCache: boolean;
  /** Rileggere il profilo e invalidare le letture in volo. */
  loadProfile: boolean;
  /**
   * Rileggerlo senza rimettere `loading`: è la stessa persona che si
   * riautentica (la verifica della password attuale) o cambia password. Con
   * `loading` il RootNavigator dell'app smonta lo Stack e il web mostra lo
   * spinner: chi cambiava la password si ritrovava sulla home.
   */
  silent: boolean;
};

/**
 * È cambiata la persona? `hadPrevious` falso = prima sessione osservata
 * (bootstrap): non c'è una cache di qualcun altro da svuotare.
 */
export function accountChanged(
  hadPrevious: boolean,
  previousUserId: string | null,
  nextUserId: string | null
): boolean {
  return hadPrevious && previousUserId !== nextUserId;
}

export function classifyAuthEvent(input: {
  event: AuthChangeEvent;
  previousUserId: string | null;
  nextUserId: string | null;
  /** C'era già una sessione osservata (anche nulla) prima di questo evento. */
  hadInitialSession: boolean;
}): AuthEventPlan {
  const { event, previousUserId, nextUserId, hadInitialSession } = input;
  // Un TOKEN_REFRESHED (o MFA_CHALLENGE_VERIFIED) della stessa persona a
  // bootstrap concluso aggiorna solo il token. Se è il primo evento
  // osservato, vale come INITIAL_SESSION.
  const loadProfile =
    !hadInitialSession ||
    previousUserId !== nextUserId ||
    event === "INITIAL_SESSION" ||
    event === "SIGNED_IN" ||
    event === "SIGNED_OUT" ||
    event === "USER_UPDATED";
  const silent =
    hadInitialSession &&
    nextUserId !== null &&
    previousUserId === nextUserId &&
    (event === "SIGNED_IN" || event === "USER_UPDATED");
  return {
    clearCache: accountChanged(hadInitialSession, previousUserId, nextUserId),
    loadProfile,
    silent,
  };
}
