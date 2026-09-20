/**
 * ⚠️ **Le recensioni sono NASCOSTE, non rimosse** (decisione 2026-09-12).
 *
 * Il prodotto si concentra su una cosa sola: la sede organizza i turni col
 * proprio organico, e il professionista li vede, tiene i propri dati e parla col
 * sede. Reputazione e QR sono un secondo prodotto dentro il primo, e finché
 * non è deciso se ci sta, non deve confondere chi apre l'app.
 *
 * Spegnere non è cancellare: la tabella `reviews`, le sue RLS, il sito
 * `web-review/` e tutto `src/features/reviews/` restano intatti e funzionanti.
 * Qui cadono solo i **punti d'ingresso**, così riaccendere costa una riga —
 * `true` — invece di riscrivere le schermate.
 *
 * Cosa gating: la scheda «Cosa dicono di te» e le celle rating in home
 * professionista, il tab Recensioni e il bottone del QR nel suo profilo, il
 * rating in «Chi lavora oggi» e nella scheda staff lato sede.
 *
 * ⚠️ Le recensioni **per esteso** non hanno più una casa: stavano sulla scheda
 * pubblica del professionista (app e dashboard), caduta col CV il 2026-09-20
 * (`20260920001700`). Riaccendendo, la media si rivede da sola dove già c'è —
 * l'elenco no, va deciso dove metterlo.
 *
 * ⚠️ Riaccendendo, ricontrollare anche: le slide di `introContent.ts`, la copy
 * di `(auth)/welcome.tsx` e la schermata di fine onboarding — sono state
 * riscritte senza recensioni e non tornano indietro da sole.
 */
export const REVIEWS_ENABLED = false;

// URL pubblico del sito di recensione (Componente B). Dev: localhost;
// in prod = URL deployato, impostato via EXPO_PUBLIC_REVIEW_SITE_URL.
export const REVIEW_SITE_URL =
  process.env.EXPO_PUBLIC_REVIEW_SITE_URL ?? "http://localhost:8080";

/** Link che il cliente apre (scansionando il QR) per recensire questo cameriere. */
export function reviewUrlFor(waiterId: string): string {
  return `${REVIEW_SITE_URL}/?w=${waiterId}`;
}
