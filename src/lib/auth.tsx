import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import { unregisterCurrentPushToken } from "@/features/push/api";
import type { Enums, Tables } from "@/types/database";

type Profile = Tables<"profiles">;
type Role = Enums<"user_role">;

type SignUpParams = {
  email: string;
  password: string;
  fullName: string;
  role: Role;
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
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) return existing;

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    role?: string;
  };
  const role: Role = meta.role === "manager" ? "manager" : "waiter";
  const { data: created } = await supabase
    .from("profiles")
    .insert({ id: user.id, full_name: meta.full_name ?? null, role })
    .select("*")
    .single();

  // Rete di sicurezza per l'aggancio alle schede staff che aspettavano questa
  // email. Il percorso normale è il trigger `profiles_link_staff_invites` sulla
  // insert qui sopra; questa chiamata copre il caso in cui il trigger non possa
  // ripassare (scheda creata dal titolare **dopo** la registrazione). Solo sul
  // ramo di insert — una volta per account, mai a ogni cold start — ed errore
  // ignorato: se fallisce, il titolare ha comunque il bottone «Reinvia invito».
  // Non attesa di proposito: il profilo è già pronto, e farci aspettare un
  // round-trip in più ritarderebbe il primo render per una chiamata che nel
  // caso normale non ha niente da fare.
  if (created) {
    void (async () => {
      try {
        await supabase.rpc("claim_staff_invites");
      } catch {
        // Il titolare ha comunque il bottone «Reinvia invito» sulla scheda.
      }
    })();
  }

  return created ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the profile for a restored/just-authed user, retrying a few times.
 * On a cold start the access token may still be refreshing, so the first RLS
 * read can come back empty; retrying rides that out instead of leaving the app
 * with a session but no profile (which renders no matching route → black screen).
 */
async function resolveProfile(user: User): Promise<Profile | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const profile = await ensureProfile(user);
    if (profile) return profile;
    await sleep(500);
  }
  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    /**
     * Chi era loggato un attimo fa. `undefined` = non lo sappiamo ancora.
     *
     * ⚠️ Serve perché diverse query key **non portano l'id dell'utente**
     * (`qk.venues.mine`, `qk.team.mine`): la loro identità è la sessione, e
     * l'unica cosa che le separa fra due account è lo svuotamento della cache.
     */
    let currentUserId: string | null | undefined;

    /**
     * Svuota la cache quando cambia la persona dietro la sessione.
     *
     * ⚠️ Non basta `SIGNED_OUT`, ed è il bug che questo sostituisce:
     * registrarsi — o fare login — mentre un altro account è ancora aperto
     * nello stesso browser emette **`SIGNED_IN` e basta**. Senza uscire prima,
     * la cache restava quella di chi c'era prima, e il nuovo account apriva
     * l'app trovandosi in lista i locali di un altro. Nessun dato nuovo
     * arrivava dal server — la RLS regge — ma quello vecchio era già lì, e a
     * schermo non c'è differenza.
     */
    function syncAccount(next: Session | null) {
      const nextId = next?.user.id ?? null;
      if (currentUserId !== undefined && currentUserId !== nextId) {
        queryClient.clear();
      }
      currentUserId = nextId;
    }

    async function loadProfile(next: Session | null) {
      if (!active) return;
      const nextProfile = next?.user ? await resolveProfile(next.user) : null;
      if (!active) return;
      setProfile(nextProfile);
      setLoading(false);
    }

    // Initial load runs outside the auth lock, so DB reads are safe to await.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      syncAccount(data.session);
      setSession(data.session);
      loadProfile(data.session);
    });

    // Subsequent changes arrive inside the auth lock: setting state is fine, but
    // Supabase queries (resolveProfile) MUST be deferred out of the callback or
    // they deadlock against the same lock. INITIAL_SESSION is handled above.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      // Prima di `setSession`: chi legge la cache al render successivo deve
      // trovarla già vuota, non i dati di chi c'era prima.
      syncAccount(next);
      setSession(next);
      // INITIAL_SESSION → handled by getSession(); TOKEN_REFRESHED → just refresh
      // the session token, no need to re-fetch the profile or blank the UI.
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED"
      ) {
        setLoading(true);
        setTimeout(() => loadProfile(next), 0);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

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
    role,
    emailRedirectTo,
  }: SignUpParams) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role }, emailRedirectTo },
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
    if (!session?.user) return;
    setProfile(await resolveProfile(session.user));
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signIn,
        signUp,
        resetPassword,
        resendConfirmation,
        updatePassword,
        signOut,
        refreshProfile,
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
