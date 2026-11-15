import type { WorkspaceAccess } from "./access";

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
  // Tre punti e non cinque (15/11): carta, partenza e «una volta sola»
  // dicevano la stessa cosa in tre righe.
  points: [
    "Tutte le funzioni, una sede, persone senza limite.",
    "Nessuna carta. I 30 giorni partono quando tocchi «Avvia la prova», una volta sola per azienda.",
    "Alla fine nessun addebito: turni e ore restano consultabili ed esportabili.",
  ],
  cta: "Avvia la prova",
  pending: "Avvio…",
  later: "Più tardi",
  laterNote: "Puoi avviarla quando vuoi dalla Home.",
  started: "Prova avviata: hai 30 giorni.",
  alreadyActive: "L'azienda è già attiva: non c'è niente da avviare.",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «Prova: ancora 12 giorni», sotto il nome dell'azienda: come la barra di
 * Deputy, chi prova sa sempre quanto gli resta (prima solo in Piano). Una
 * frazione di giorno conta intera; `null` fuori dalla prova o a prova finita.
 */
export function trialLeftLabel(access: WorkspaceAccess | undefined, now: number): string | null {
  if (!access || access.state !== "operational" || access.source !== "trial") return null;
  if (!access.operational_until) return null;
  const left = Date.parse(access.operational_until) - now;
  if (left <= 0) return null;
  const days = Math.ceil(left / DAY_MS);
  return days <= 1 ? "Prova: ultimo giorno" : `Prova: ancora ${days} giorni`;
}
