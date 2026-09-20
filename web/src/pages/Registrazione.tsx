import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth";
import { signupSchema, type SignupForm } from "@/features/auth/schema";
import { Button, Field, Input, PasswordInput } from "../ui/primitives";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { PasswordChecklist } from "../ui/PasswordChecklist";
import {
  resendLabel,
  useResendConfirmation,
} from "@/features/auth/useResendConfirmation";

/**
 * Registrazione dalla dashboard. Il ruolo non si sceglie: questa interfaccia
 * esiste per chi gestisce una sede, quindi l'account nasce `manager` (un
 * professionista finirebbe su NotForWaitersPage al primo accesso).
 *
 * ⚠️ Il collaboratore invitato **non passa più di qui**: dal 16/09 il suo
 * account nasce su `Invito.tsx`, dal link ricevuto per email, con il ruolo già
 * giusto. Registrarsi a mano con l'indirizzo dell'invito continua a funzionare
 * (`claim_staff_invites()` aggancia al primo accesso), ma non è più la strada
 * che gli indichiamo: sceglierebbe di nuovo il ruolo, ed era lì che l'invito si
 * rompeva in silenzio.
 *
 * `signupSchema` arriva dall'app: le regole di validazione restano una sola
 * fonte, allineata a Supabase Auth.
 */
export function RegistrazionePage() {
  const { signUp } = useAuth();
  const [apiError, setApiError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });
  const password = useWatch({ control, name: "password" }) ?? "";

  const onSubmit = handleSubmit(async (values) => {
    if (busy) return;
    setApiError(null);
    setEmailTaken(false);
    setBusy(true);
    const res = await signUp({
      email: values.email.trim(),
      password: values.password,
      fullName: values.fullName.trim(),
      intent: "manager",
      // Il link di conferma deve riportare qui, non al Site URL del progetto
      // (che porta all'app). Richiede questo URL fra i "Redirect URLs" di
      // Supabase; se manca, si torna al Site URL e la registrazione è comunque
      // valida.
      emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
    });
    setBusy(false);
    if (res.error) {
      setApiError(res.error);
      return;
    }
    if (res.alreadyRegistered) {
      setEmailTaken(true);
      return;
    }
    if (res.needsConfirmation) {
      setSentTo(values.email.trim());
      return;
    }
    // Con la conferma email disattivata la sessione è già attiva: ci pensa
    // AuthProvider, e <App /> passa da sé alla dashboard.
  });

  if (sentTo) return <CheckYourMail email={sentTo} />;

  return (
    <AuthShell
      title="Crea il tuo account"
      subtitle="La dashboard di chi organizza i turni di una sede."
    >
      <AuthPanel>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Nome e cognome" error={errors.fullName?.message}>
            <Input
              {...register("fullName")}
              autoComplete="name"
              placeholder="Mario Rossi"
            />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <Input
              {...register("email")}
              type="email"
              autoComplete="email"
              placeholder="nome@sede.it"
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <PasswordInput
              {...register("password")}
              autoComplete="new-password"
            />
          </Field>

          <PasswordChecklist value={password} />

          {apiError ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {apiError}
            </p>
          ) : null}
          {emailTaken ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              Esiste già un account con questa email.{" "}
              <Link to="/login" className="focus-gold font-semibold underline">
                Accedi
              </Link>{" "}
              o recupera la password dall&apos;app.
            </p>
          ) : null}

          <Button type="submit" variant="gold" disabled={busy}>
            {busy ? "Creazione…" : "Crea account"}
          </Button>

          <p className="text-center text-xs leading-5 text-t4">
            Stai creando un account da sede. Se ti ha invitato qualcuno a
            gestire il suo, usa l&apos;indirizzo a cui è arrivato l&apos;invito:
            è quello che ti collega alla sua sede.
            <br />
            Se lavori come professionista, la registrazione si fa
            dall&apos;app KlokShift sul telefono.
          </p>
        </form>
      </AuthPanel>

      <p className="mt-5 text-center text-xs text-t3">
        Hai già un account?{" "}
        <Link
          to="/login"
          className="focus-gold font-semibold text-gold hover:underline"
        >
          Accedi
        </Link>
      </p>
    </AuthShell>
  );
}

/**
 * «Controlla la posta», con la via d'uscita per quando la posta non arriva.
 *
 * Senza il rinvio, chi non riceve il messaggio — casella piena, spam, un
 * filtro aziendale — resta con un account che esiste e non può usare, e
 * l'unica uscita sarebbe registrarsi con un altro indirizzo: proprio quello da
 * evitare, perché è l'indirizzo a collegarlo all'accesso che gli hanno
 * preparato.
 */
function CheckYourMail({ email }: { email: string }) {
  // `true`: l'email della registrazione è appena partita, quindi il contatore
  // parte da fermo. Offrire subito il bottone vorrebbe dire offrire un 429.
  const resend = useResendConfirmation(
    email,
    `${window.location.origin}/`,
    true
  );

  return (
    <AuthShell title="Controlla la posta">
      <AuthPanel>
        <p className="text-sm leading-6 text-t2">
          Abbiamo inviato un link di conferma a{" "}
          <span className="font-semibold text-t1">{email}</span>. Aprilo per
          attivare l&apos;account, poi torna qui e accedi. Se ti hanno invitato,
          al primo accesso troverai già la sede che gestisci.
        </p>

        <p className="mt-4 text-xs leading-5 text-t4">
          Non è arrivata? Controlla lo spam. Se non c&apos;è nemmeno lì,
          possiamo rimandarla.
        </p>

        {resend.sent ? (
          <p className="mt-3 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            Email rimandata a {email}.
          </p>
        ) : null}
        {resend.error ? (
          <p className="mt-3 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            {resend.error}
          </p>
        ) : null}

        <Button
          className="mt-3 w-full"
          disabled={resend.busy || resend.secondsLeft > 0}
          onClick={resend.resend}
        >
          {resendLabel(resend)}
        </Button>

        <Link
          to="/login"
          className="focus-gold mt-3 inline-flex w-full items-center justify-center rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
        >
          Vai all&apos;accesso
        </Link>
      </AuthPanel>
    </AuthShell>
  );
}
