import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

/**
 * «Non mi è arrivata niente»: il rinvio dell'email di conferma.
 *
 * Senza questo, chi si registra e non riceve il messaggio — casella piena,
 * spam, un refuso che ha mangiato la mail — resta con un account che esiste e
 * non può usare, e l'unica uscita è registrarsi di nuovo con un altro
 * indirizzo. Che è esattamente quello che non vogliamo, perché è l'indirizzo a
 * collegarlo alla scheda o all'accesso che qualcuno gli ha preparato.
 *
 * ⚠️ L'attesa non è un vezzo di prodotto, è il riflesso di due limiti veri di
 * GoTrue, e vale la pena tenerli distinti:
 *
 *   1. **per indirizzo**, ~60 secondi fra due richieste. È quello che conta
 *      qui: il contatore serve a non far premere un bottone che risponderebbe
 *      429. Si parte da subito dopo il primo invio — quello della
 *      registrazione, che è già partito.
 *   2. **per progetto**, il tetto delle email spedite in un'ora (2 con il
 *      servizio integrato di Supabase, di più con un SMTP proprio). Quello non
 *      si può prevedere dal client: quando scatta, si mostra il messaggio che
 *      torna dal server.
 *
 * Nessun import di Expo o di React Native: lo riusano sia l'app sia la
 * dashboard.
 */

/** I secondi fra due rinvii. Allineato al limite per indirizzo di GoTrue. */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendConfirmation = {
  /** Manda (o rimanda) l'email. No-op mentre il contatore scorre. */
  resend: () => void;
  /** Secondi che mancano al prossimo rinvio possibile. `0` = si può. */
  secondsLeft: number;
  busy: boolean;
  /** `true` dopo un rinvio riuscito, finché non se ne chiede un altro. */
  sent: boolean;
  /** Il messaggio del server, già in italiano. `null` se non c'è. */
  error: string | null;
};

export function useResendConfirmation(
  email: string | null | undefined,
  /** Dove atterra il link. Serve al web, che vive su un URL proprio. */
  emailRedirectTo?: string,
  /**
   * `true` quando un'email è **appena** partita per altra via — il caso della
   * schermata «controlla la posta» subito dopo la registrazione. Fa partire il
   * contatore da fermo, invece di offrire un bottone che darebbe 429.
   */
  startOnCooldown = false
): ResendConfirmation {
  const { resendConfirmation } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(
    startOnCooldown ? RESEND_COOLDOWN_SECONDS : 0
  );
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ La dipendenza è il **booleano**, non `secondsLeft`: con il numero
  // l'effetto rientrerebbe a ogni tick, buttando via un intervallo e creandone
  // un altro una volta al secondo. Così parte una volta sola, al passaggio da
  // fermo a in corso, e si smonta quando arriva a zero.
  const running = secondsLeft > 0;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const resend = useCallback(() => {
    const address = email?.trim();
    if (!address || busy || secondsLeft > 0) return;
    setBusy(true);
    setError(null);
    setSent(false);
    void resendConfirmation(address, emailRedirectTo).then((res) => {
      setBusy(false);
      if (res.error) {
        setError(res.error);
        // Anche un rifiuto consuma il tentativo lato server: ripartire subito
        // vorrebbe dire solo un secondo 429.
        setSecondsLeft(RESEND_COOLDOWN_SECONDS);
        return;
      }
      setSent(true);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    });
  }, [email, busy, secondsLeft, resendConfirmation, emailRedirectTo]);

  return { resend, secondsLeft, busy, sent, error };
}

/** «Rimanda l'email» / «Rimanda fra 45s» / «Invio…» — una frase sola, un posto solo. */
export function resendLabel(state: ResendConfirmation): string {
  if (state.busy) return "Invio…";
  if (state.secondsLeft > 0) return `Rimanda fra ${state.secondsLeft}s`;
  return "Rimanda l'email";
}
