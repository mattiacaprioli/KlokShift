/**
 * Cosa promette la prova, detto uguale in app, sulla dashboard e in Piano.
 * Solo dati, niente React Native: la dashboard lo importa così com'è.
 *
 * ⚠️ Lo legge anche l'app nativa: niente prezzi, acquisti o abbonamenti
 * (App Store 3.1.3, vedi AGENTS.md «Monetizzazione»). Le regole stanno in
 * docs/MONETIZATION.md §3: se cambiano, cambia qui.
 */
export const TRIAL_COPY = {
  eyebrow: "Ultimo passo",
  title: "La tua prova di 30 giorni",
  lead: "L'azienda è pronta. Per aggiungere persone e creare turni avvia la prova: la fai partire tu, quando vuoi.",
  points: [
    "Tutte le funzioni, una sede, persone senza limite.",
    "Nessuna carta richiesta.",
    "I 30 giorni partono da quando tocchi «Avvia la prova».",
    "Si attiva una volta sola per azienda.",
    "Alla fine nessun addebito: turni e ore restano consultabili ed esportabili.",
  ],
  cta: "Avvia la prova",
  pending: "Avvio…",
  later: "Più tardi",
  laterNote: "Puoi avviarla quando vuoi dalla Home.",
  started: "Prova avviata: hai 30 giorni.",
  alreadyActive: "L'azienda è già attiva: non c'è niente da avviare.",
} as const;
