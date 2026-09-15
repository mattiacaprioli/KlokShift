import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { isPasswordValid, passwordRules } from "@/features/auth/schema";
import { cn } from "@/lib/cn";
import { Button, Field, PasswordInput } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { useToast } from "../ui/Toast";

/**
 * I due link che portano qui.
 *
 * `recovery` è chi ha perso la password. `invite` è il collaboratore che entra
 * la prima volta: il suo account l'ha creato il titolare, quindi non ha mai
 * scelto una password e non ne sta recuperando nessuna. Cambia solo il testo —
 * quello che si fa è identico, e due pagine gemelle si sarebbero disallineate
 * alla prima modifica.
 */
const COPY = {
  recovery: {
    title: "Nuova password",
    subtitle: "Scegli la password con cui entrerai da qui e dall'app.",
    deadTitle: "Link non valido",
    dead: "Questo indirizzo funziona solo aprendo il link di recupero appena ricevuto per email. Se è passato troppo tempo, richiedine uno nuovo dalla pagina di accesso.",
    done: "Password aggiornata.",
  },
  invite: {
    title: "Scegli la tua password",
    subtitle:
      "Il tuo accesso è già attivo: questa password serve a rientrare, da qui e dall'app.",
    deadTitle: "Invito non valido",
    dead: "Questo indirizzo funziona solo aprendo il link d'invito ricevuto per email. I link valgono 24 ore e una volta sola: se è scaduto, chiedi a chi ti ha invitato di rimandartelo.",
    done: "Password impostata. Benvenuto.",
  },
} as const;

/**
 * Dove si sceglie la password: fine del recupero, o primo accesso di un
 * collaboratore invitato. Ci si arriva solo dal link ricevuto per email, con la
 * sessione già attiva (vedi `lib/recovery.ts`).
 *
 * È l'unica pagina che sta davanti a tutti i gate di <App />: senza, chi ha perso
 * la password da scrivania non avrebbe modo di rientrare.
 *
 * ⚠️ Nel caso `invite` l'accesso è già attivo prima di questo form: aprire il
 * link conferma l'email, e da lì `ensureProfile` + `link_venue_access_for_user`
 * fanno il resto. Chi abbandona qui è dentro a tutti gli effetti, ma senza
 * password — rientra solo da "password dimenticata". Il sottotitolo lo dice.
 */
export function NuovaPasswordPage({
  variant = "recovery",
}: {
  variant?: keyof typeof COPY;
}) {
  const copy = COPY[variant];
  const { session, updatePassword } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!isPasswordValid(password)) {
      setError("La password non rispetta i requisiti indicati.");
      return;
    }
    if (password !== confirm) {
      setError("Le due password non coincidono.");
      return;
    }
    setBusy(true);
    const res = await updatePassword(password);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Quella del link è a tutti gli effetti una sessione: si entra
    // direttamente, senza far riscrivere la password appena impostata.
    toast.show(copy.done);
    navigate("/", { replace: true });
  }

  // Nessuna sessione: il link è scaduto, è già stato usato, oppure si è
  // arrivati qui a mano digitando la rotta.
  if (!session) {
    return (
      <AuthShell title={copy.deadTitle}>
        <AuthPanel>
          <p className="text-sm leading-6 text-t2">{copy.dead}</p>
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
    <AuthShell title={copy.title} subtitle={copy.subtitle}>
      <AuthPanel>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Nuova password">
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

          <ul className="flex flex-col gap-1.5">
            {passwordRules.map((rule) => {
              const ok = rule.test(password);
              return (
                <li
                  key={rule.label}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    ok ? "text-success" : "text-t3"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                      ok
                        ? "bg-success text-bg-0"
                        : "border border-border-2 text-transparent"
                    )}
                  >
                    ✓
                  </span>
                  {rule.label}
                </li>
              );
            })}
          </ul>

          {error ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="gold" disabled={busy}>
            {busy ? "Salvataggio…" : "Salva e accedi"}
          </Button>
        </form>
      </AuthPanel>
    </AuthShell>
  );
}
