import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { isPasswordValid } from "@/features/auth/schema";
import { Button, Field, PasswordInput } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { PasswordChecklist } from "../ui/PasswordChecklist";
import { useToast } from "../ui/Toast";

/**
 * Fine del recupero password: ci si arriva solo dal link ricevuto per email, con
 * la sessione di recupero già attiva (vedi `lib/recovery.ts`).
 *
 * È l'unica pagina che sta davanti a tutti i gate di <App />: senza, chi ha perso
 * la password da scrivania non avrebbe modo di rientrare.
 *
 * ⚠️ Non è la pagina del collaboratore invitato: quella è `Invito.tsx`, dove la
 * password non si *cambia* ma si sceglie per la prima volta, e insieme fa
 * nascere l'account. Le due si assomigliano solo in superficie — qui c'è già una
 * sessione, lì non c'è ancora nemmeno un utente.
 */
export function NuovaPasswordPage() {
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
    // La sessione di recupero è a tutti gli effetti una sessione: si entra
    // direttamente, senza far riscrivere la password appena impostata.
    toast.show("Password aggiornata.");
    navigate("/", { replace: true });
  }

  // Nessuna sessione: il link è scaduto, è già stato usato, oppure si è
  // arrivati qui a mano digitando la rotta.
  if (!session) {
    return (
      <AuthShell title="Link non valido">
        <AuthPanel>
          <p className="text-sm leading-6 text-t2">
            Questo indirizzo funziona solo aprendo il link di recupero appena
            ricevuto per email. Se è passato troppo tempo, richiedine uno nuovo
            dalla pagina di accesso.
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
      title="Nuova password"
      subtitle="Scegli la password con cui entrerai da qui e dall'app."
    >
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

          <PasswordChecklist value={password} />

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
