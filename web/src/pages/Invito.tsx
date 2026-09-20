import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { functionErrorCode } from "@/lib/functionError";
import {
  isPasswordValid,
  passwordMismatchMessage,
} from "@/features/auth/schema";
import { Button, Field, Input, PasswordInput, Spinner } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { PasswordChecklist } from "../ui/PasswordChecklist";
import { useToast } from "../ui/Toast";

/**
 * Primo accesso del collaboratore invitato: qui l'account **nasce**.
 *
 * Fino al 16/09 l'account lo creava `generateLink({ type: 'invite' })` al
 * momento dell'invio, e costava due cose. L'indirizzo restava occupato anche per
 * chi l'invito non lo apriva mai — e quella persona non poteva più registrarsi
 * da nessuna parte. E aprire il link attivava l'accesso **prima** della
 * password, lasciando dentro senza password chi abbandonava a metà.
 *
 * Ora nell'email c'è un token monouso, e questa pagina lo scambia con un account
 * nel momento in cui si preme «Entra»: `accept-invite` fa `createUser` con la
 * password scelta qui e `email_confirm` insieme. Prima di quel momento non
 * esiste nessun `auth.users`, quindi ignorare l'email non ha conseguenze.
 *
 * ⚠️ Non è `NuovaPassword.tsx`, che le assomiglia solo in superficie: là c'è già
 * una sessione e la password si cambia, qui non c'è ancora nemmeno un utente.
 * Sta davanti a tutti i gate di <App /> per la stessa ragione dell'altra.
 */

/** Gli errori della Edge Function, tradotti. La chiave è `error` nel body. */
const ERRORS: Record<string, string> = {
  invite_not_found:
    "Questo link non è valido, oppure è già stato usato. Chiedi a chi ti ha invitato di rimandartelo.",
  invite_used:
    "Questo invito è già stato accettato. Se l'account è tuo, entra dalla pagina di accesso.",
  invite_expired:
    "Questo invito è scaduto. Chiedi a chi ti ha invitato di rimandartelo: il link nuovo vale sette giorni.",
  already_linked:
    "Questo invito non è più valido: l'accesso è stato revocato o è già collegato a un account.",
  email_taken:
    "Esiste già un account con questa email. Entra dalla pagina di accesso: l'invito si collega da solo al primo accesso.",
  weak_password: "La password non rispetta i requisiti indicati.",
};

function errorMessage(code: string | undefined): string {
  return (
    (code && ERRORS[code]) ??
    "Non siamo riusciti a completare l'invito. Riprova tra qualche minuto."
  );
}

type Invite = { email: string; displayName: string; workspaceName: string };

/**
 * Uno stato solo e non tre booleani: «sto verificando», «ecco l'invito» e «questo
 * link non vale» si escludono a vicenda, e tenerli separati permetterebbe di
 * mostrare il form di un invito già scaduto.
 */
type State =
  | { status: "loading" }
  | { status: "ok"; invite: Invite }
  | { status: "dead"; message: string };

/**
 * Chiama `accept-invite` e riduce l'esito a «dati» oppure «codice d'errore».
 *
 * Il codice sta nel corpo della risposta dentro `error.context`, non in `data`
 * (vedi `functionErrorCode`). Se la function non è deployata il gateway risponde
 * `NOT_FOUND`, che qui diventa il messaggio generico: a chi apre un invito non
 * serve sapere com'è fatto il backend.
 */
async function callAcceptInvite<T>(
  body: Record<string, unknown>
): Promise<{ data: T } | { code: string }> {
  const { data, error } = await supabase.functions.invoke<T>("accept-invite", {
    body,
  });
  if (!error && data) return { data };
  const raw = await functionErrorCode(error);
  const known = Object.keys(ERRORS).find((k) => raw.includes(k));
  return { code: known ?? "unknown" };
}

export function InvitoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get("t") ?? "";

  // Il caso "nessun token" è deciso al primo render, non da un effetto: un
  // `setState` sincrono dentro `useEffect` fa un secondo render per dire una
  // cosa che si sapeva già dall'URL.
  const [state, setState] = useState<State>(() =>
    token
      ? { status: "loading" }
      : { status: "dead", message: ERRORS.invite_not_found }
  );

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Chi invita e dove, prima di chiedere una password a qualcuno che non sa
  // ancora di cosa si tratta. Il token non viene speso: `peek` è sola lettura.
  useEffect(() => {
    if (!token) return;
    let active = true;
    void (async () => {
      const res = await callAcceptInvite<Invite>({ op: "peek", token });
      if (!active) return;
      if ("code" in res) {
        setState({ status: "dead", message: errorMessage(res.code) });
        return;
      }
      // Il nome l'ha già scritto chi invita: si propone, e resta modificabile —
      // è la persona a sapere come si chiama.
      setFullName((prev) => prev || res.data.displayName || "");
      setState({ status: "ok", invite: res.data });
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const invite = state.status === "ok" ? state.invite : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !invite) return;
    setError(null);
    if (!isPasswordValid(password)) {
      setError("La password non rispetta i requisiti indicati.");
      return;
    }
    if (password !== confirm) {
      setError(passwordMismatchMessage);
      return;
    }

    setBusy(true);
    const res = await callAcceptInvite<{ ok: boolean }>({
      op: "accept",
      token,
      password,
      fullName,
    });
    if ("code" in res) {
      setBusy(false);
      // Un invito scaduto o già speso non è un errore del form: il modulo non
      // serve più, e lasciarlo in piedi inviterebbe a ritentare a vuoto.
      if (res.code in ERRORS && res.code !== "weak_password") {
        setState({ status: "dead", message: errorMessage(res.code) });
        return;
      }
      setError(errorMessage(res.code));
      return;
    }

    // L'account esiste ora: si entra subito con la password appena scelta,
    // invece di rimbalzare al login a riscriverla. Da qui in poi è AuthProvider
    // a fare il resto — profilo `manager`, aggancio degli accessi, notifiche.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: invite.email,
      password,
    });
    setBusy(false);
    if (signInError) {
      // Caso raro e non bloccante: l'account c'è, manca solo la sessione.
      setError("Account creato. Entra dalla pagina di accesso con questa password.");
      return;
    }
    toast.show("Benvenuto in KlokShift.");
    navigate("/", { replace: true });
  }

  if (state.status === "loading") return <Spinner label="Verifica invito…" />;

  if (state.status === "dead" || !invite) {
    return (
      <AuthShell title="Invito non valido">
        <AuthPanel>
          <p className="text-sm leading-6 text-t2">
            {state.status === "dead" ? state.message : ERRORS.invite_not_found}
          </p>
          <Link
            to="/login"
            className="focus-gold mt-5 inline-flex w-full items-center justify-center rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
          >
            Vai all&apos;accesso
          </Link>
        </AuthPanel>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Scegli la tua password"
      subtitle={`${invite.workspaceName} ti ha dato accesso alla gestione.`}
    >
      <AuthPanel>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="rounded-xl border border-border-2 bg-bg-2 px-3 py-2.5 text-xs leading-5 text-t3">
            Il tuo account sarà <strong className="text-t2">{invite.email}</strong>
            . Con questa password entri sia da qui che dall&apos;app KlokShift.
          </p>

          <Field label="Come ti chiami">
            <Input
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nome e cognome"
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Ripeti la password">
            <PasswordInput
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          <PasswordChecklist value={password} />

          {error ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="gold" disabled={busy}>
            {busy ? "Creazione…" : "Crea l'account ed entra"}
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}
