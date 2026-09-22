import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import { unregisterCurrentPushToken } from "@/features/push/api";
import type { Tables } from "@/types/database";
import { createAuthRequestGate, type AuthRequestTicket } from "@/lib/authRequestGate";

type Profile = Tables<"profiles">;

/**
 * Cosa la persona dice di voler fare, alla registrazione: gestire un'azienda o
 * lavorarci. È **solo un suggerimento** per la prima schermata (finisce in
 * `user_metadata.intent`): non è un ruolo, non dà permessi, e le appartenenze
 * reali le dice `get_my_context()`. Il profilo non ha più un campo `role`.
 */
type Intent = "manager" | "waiter";

type SignUpParams = {
  email: string;
  password: string;
  fullName: string;
  intent: Intent;
  /**
   * Dove riportare l'utente dopo il click sul link di conferma email. Serve
   * solo alla dashboard web, che vive su un URL: sul mobile si omette e vale
   * il Site URL del progetto. Supabase lo onora solo se l'URL è in allowlist
   * (Authentication → URL Configuration), altrimenti ripiega sul Site URL.
   */
  emailRedirectTo?: string;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: Error | null;
  /**
   * `needsConfirmation`: l'account esiste ma l'email non è mai stata
   * confermata. È un flag e non un confronto sulla stringa tradotta, perché la
   * schermata di login su quel caso deve offrire il rinvio — e legare
   * un'interazione al testo di un messaggio vuol dire romperla la prima volta
   * che qualcuno lo riscrive.
   */
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signUp: (params: SignUpParams) => Promise<{
    error: string | null;
    needsConfirmation: boolean;
    alreadyRegistered: boolean;
  }>;
  /**
   * `redirectTo`: dove deve atterrare il link di recupero. Vale la stessa
   * regola di `emailRedirectTo` (allowlist, altrimenti Site URL). Omesso
   * sull'app, che non ha una pagina propria dove impostare la password.
   */
  resetPassword: (
    email: string,
    redirectTo?: string
  ) => Promise<{ error: string | null }>;
  /**
   * Rimanda l'email di conferma a chi si è registrato e non l'ha mai ricevuta.
   *
   * ⚠️ La risposta è **sempre** senza errore quando l'indirizzo non è
   * rimandabile (non esiste, o è già confermato): GoTrue non distingue i due
   * casi di proposito, e nemmeno noi — dire «questa email non esiste» a chi
   * non è loggato è un oracolo di enumerazione. L'unico errore che torna
   * davvero è il rate limit, che l'utente deve poter leggere.
   */
  resendConfirmation: (
    email: string,
    emailRedirectTo?: string
  ) => Promise<{ error: string | null }>;
  /** Cambia la password dell'utente in sessione (anche di sola recovery). */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Re-fetch the profile row after an edit, without blanking the UI. */
  refreshProfile: () => Promise<void>;
  /** Riprova il bootstrap o il caricamento profilo fallito. */
  retryProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve essere usato dentro <AuthProvider />");
  }
  return ctx;
}

async function ensureProfile(user: User): Promise<Profile | null> {
  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return existing;

  // Di norma il profilo lo ha già creato il trigger su `auth.users` alla
  // registrazione. Questo insert è la rete di sicurezza: il trigger non deve mai
  // bloccare una registrazione, quindi in caso di errore ripiega su un warning e
  // qui lo si ricrea.
  const meta = (user.user_metadata ?? {}) as { full_name?: string };
  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({ id: user.id, full_name: meta.full_name ?? null })
    .select("*")
    .single();
  if (createError) throw new Error(createError.message);

  return created ?? null;
}

/**
 * Aggancia le schede che aspettavano questo indirizzo (organico e collaboratori:
 * ora sono la stessa cosa, un membro dell'azienda) e ricarica le liste se ne ha
 * agganciato qualcuna.
 *
 * ⚠️ **A ogni accesso, non solo alla creazione del profilo.** Prima questa
 * chiamata stava dentro `ensureProfile`, sul solo ramo di insert: copriva
 * «prima mi invitano, poi mi registro» e mancava il caso opposto, che è quello
 * comune — l'account esiste già e il titolare invita dopo. Lì l'aggancio
 * immediato dipende da `find_team_candidate`, che non trova l'indirizzo finché
 * l'email non è confermata: la riga resta `pending`, il profilo non viene più
 * inserito, nessun trigger ci ripassa. Un invito lettera morta, senza un errore
 * da nessuna parte — né per chi invita né per chi è invitato.
 *
 * Il costo è una RPC per accesso: due select indicizzate che nel caso normale
 * non trovano niente. Sta nel ramo `SIGNED_IN` e non nel ripristino di sessione
 * di proposito — un login è raro, un cold start no.
 *
 * L'errore si ignora: se fallisce, il titolare ha ancora il pulsante «Reinvia».
 */
async function claimInvites(): Promise<void> {
  try {
    const { data } = await supabase.rpc("claim_invites");
    // Invalidazione larga e non mirata: agganciare un invito cambia le sedi, i
    // collaboratori, l'organico e le notifiche insieme, e capita una volta
    // nella vita di un account. Elencare le chiavi vorrebbe dire dimenticarne
    // una alla prossima feature.
    if ((data ?? 0) > 0) await queryClient.invalidateQueries();
  } catch {
    // Vedi sopra.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the profile for a restored/just-authed user, retrying a few times.
 * On a cold start the access token may still be refreshing, so the first RLS
 * read can come back empty; retrying rides that out instead of leaving the app
 * with a session but no profile (which renders no matching route → black screen).
 */
async function resolveProfile(user: User): Promise<Profile | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const profile = await ensureProfile(user);
      if (profile) return profile;
      lastError = new Error("Profilo non disponibile");
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await sleep(500);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Non siamo riusciti a caricare il profilo");
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const sessionRef = useRef<Session | null | undefined>(undefined);
  const requestGateRef = useRef(createAuthRequestGate());

  const syncSession = useCallback((next: Session | null) => {
    const previous = sessionRef.current;
    const previousId = previous?.user.id ?? null;
    const nextId = next?.user.id ?? null;
    if (previous !== undefined && previousId !== nextId) queryClient.clear();
    if (previousId !== nextId) {
      setProfile(null);
      setError(null);
    }
    sessionRef.current = next;
    setSession(next);
  }, []);

  const beginProfileLoad = useCallback((next: Session | null) => {
    const ticket = requestGateRef.current.begin(next?.user.id ?? null);
    setLoading(true);
    setError(null);
    return ticket;
  }, []);

  const finishProfileLoad = useCallback(
    async (
      next: Session | null,
      ticket: AuthRequestTicket,
      claim = false
    ) => {
      try {
        const nextProfile = next?.user ? await resolveProfile(next.user) : null;
        if (!mountedRef.current || !requestGateRef.current.isCurrent(ticket)) {
          return;
        }
        setProfile(nextProfile);
        setError(null);
        setLoading(false);
        if (claim && nextProfile) void claimInvites();
      } catch (cause) {
        if (!mountedRef.current || !requestGateRef.current.isCurrent(ticket)) {
          return;
        }
        setProfile(null);
        setError(
          cause instanceof Error
            ? cause
            : new Error("Non siamo riusciti a caricare il profilo")
        );
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    const requestGate = requestGateRef.current;
    const bootstrapSnapshot = requestGate.snapshot();

    // Initial load runs outside the auth lock, so DB reads are safe to await.
    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (
          !mountedRef.current ||
          !requestGate.isSnapshotCurrent(bootstrapSnapshot)
        ) {
          return;
        }
        if (sessionError) throw sessionError;
        syncSession(data.session);
        const ticket = beginProfileLoad(data.session);
        void finishProfileLoad(data.session, ticket);
      })
      .catch((cause: unknown) => {
        if (
          !mountedRef.current ||
          !requestGate.isSnapshotCurrent(bootstrapSnapshot)
        ) {
          return;
        }
        setError(
          cause instanceof Error
            ? cause
            : new Error("Non siamo riusciti a verificare la sessione")
        );
        setLoading(false);
      });

    // Subsequent changes arrive inside the auth lock: setting state is fine, but
    // Supabase queries (resolveProfile) MUST be deferred out of the callback or
    // they deadlock against the same lock. Anche INITIAL_SESSION passa qui: il
    // gate rende innocuo il doppio ingresso con getSession().
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mountedRef.current) return;
      const hadInitialSession = sessionRef.current !== undefined;
      const previousId = sessionRef.current?.user.id ?? null;
      const nextId = next?.user.id ?? null;
      const shouldLoadProfile =
        !hadInitialSession ||
        previousId !== nextId ||
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED";
      // Invalida subito bootstrap e letture in volo, prima del setTimeout. Un
      // semplice TOKEN_REFRESHED della stessa persona non deve interrompere il
      // profilo che si sta già caricando.
      if (shouldLoadProfile) requestGate.invalidate(nextId);
      // Prima di `setSession`: chi legge la cache al render successivo deve
      // trovarla già vuota, non i dati di chi c'era prima.
      syncSession(next);
      // TOKEN_REFRESHED aggiorna soltanto il token se il bootstrap era già
      // concluso. Se è il primo evento osservato, vale come INITIAL_SESSION.
      if (shouldLoadProfile) {
        const ticket = beginProfileLoad(next);
        setTimeout(
          () => void finishProfileLoad(next, ticket, event === "SIGNED_IN"),
          0
        );
      }
    });

    return () => {
      mountedRef.current = false;
      requestGate.invalidate(null);
      sub.subscription.unsubscribe();
    };
  }, [beginProfileLoad, finishProfileLoad, syncSession]);

  // ⚠️ Le quattro funzioni qui sotto restituiscono l'errore **già tradotto**.
  // Prima tornava il messaggio grezzo di Supabase e la traduzione la faceva chi
  // chiamava: bastava dimenticarsene una volta — ed è successo, sul login del
  // web — perché all'utente comparisse "Invalid login credentials". Tradurre
  // qui è l'unico modo in cui non si può saltare.
  //
  // Corollario: chi chiama NON deve ripassare da `authErrorMessage`. Applicarla
  // a una stringa già italiana non trova nessuna corrispondenza e la degrada
  // nel generico "Si è verificato un errore", che è peggio dell'inglese perché
  // perde anche l'informazione.
  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return {
      error: error ? authErrorMessage(error.message) : null,
      needsConfirmation: !!error?.message
        .toLowerCase()
        .includes("email not confirmed"),
    };
  }

  async function resendConfirmation(email: string, emailRedirectTo?: string) {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });
    return { error: error ? authErrorMessage(error.message) : null };
  }

  async function signUp({
    email,
    password,
    fullName,
    intent,
    emailRedirectTo,
  }: SignUpParams) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, intent }, emailRedirectTo },
    });
    if (error) {
      return {
        error: authErrorMessage(error.message),
        needsConfirmation: false,
        alreadyRegistered: false,
      };
    }
    // Con la conferma email attiva, Supabase risponde con un finto successo se
    // l'email è già registrata (anti-enumerazione): l'unico segnale è
    // identities vuoto sull'utente restituito.
    const alreadyRegistered =
      !data.session && data.user?.identities?.length === 0;
    return {
      error: null,
      needsConfirmation: !data.session && !alreadyRegistered,
      alreadyRegistered,
    };
  }

  async function resetPassword(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined
    );
    return { error: error ? authErrorMessage(error.message) : null };
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error ? authErrorMessage(error.message) : null };
  }

  async function signOut() {
    // De-registra il push token PRIMA del signOut: dopo, la RLS "own only"
    // blocca la delete. Best-effort: non deve mai impedire il logout.
    try {
      await unregisterCurrentPushToken();
    } catch {
      // ignora: il cleanup dei token morti avviene comunque lato Edge Function.
    }
    await supabase.auth.signOut();
  }

  // Re-read the profile after the user edits it. Deliberately does NOT touch `loading`
  // (that would make RootNavigator blank the app); just swaps in the fresh row.
  async function refreshProfile() {
    const next = sessionRef.current;
    if (!next?.user) return;
    const ticket = requestGateRef.current.begin(next.user.id);
    try {
      const nextProfile = await resolveProfile(next.user);
      if (
        mountedRef.current &&
        requestGateRef.current.isCurrent(ticket)
      ) {
        setProfile(nextProfile);
      }
    } catch (cause) {
      // Se nel frattempo è cambiata la sessione, questo errore appartiene alla
      // richiesta vecchia quanto il suo risultato e non va propagato.
      if (!requestGateRef.current.isCurrent(ticket)) return;
      throw cause;
    }
  }

  async function retryProfile() {
    let next = sessionRef.current;
    if (next === undefined) {
      const snapshot = requestGateRef.current.snapshot();
      setLoading(true);
      setError(null);
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!requestGateRef.current.isSnapshotCurrent(snapshot)) return;
        if (sessionError) throw sessionError;
        next = data.session;
        syncSession(next);
      } catch (cause) {
        if (!requestGateRef.current.isSnapshotCurrent(snapshot)) return;
        setError(
          cause instanceof Error
            ? cause
            : new Error("Non siamo riusciti a verificare la sessione")
        );
        setLoading(false);
        return;
      }
    }
    const ticket = beginProfileLoad(next);
    await finishProfileLoad(next, ticket);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        error,
        signIn,
        signUp,
        resetPassword,
        resendConfirmation,
        updatePassword,
        signOut,
        refreshProfile,
        retryProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function authErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email o password non corretti.";
  }
  if (m.includes("user already registered")) {
    return "Esiste già un account con questa email.";
  }
  if (m.includes("password should be at least")) {
    return "La password deve avere almeno 6 caratteri.";
  }
  if (m.includes("unable to validate email") || m.includes("invalid email")) {
    return "Inserisci un indirizzo email valido.";
  }
  if (m.includes("email not confirmed")) {
    return "Conferma la tua email prima di accedere.";
  }
  if (m.includes("different from the old password")) {
    return "La nuova password deve essere diversa dalla precedente.";
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
