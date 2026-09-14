/**
 * Pagine legali pubbliche. Stanno alla radice del sito vetrina (`web-site/`,
 * su GitHub Pages) con i nomi di file di sempre: gli stessi indirizzi sono
 * dichiarati nelle schede degli store — Play Console chiede sia l'URL
 * dell'informativa sia quello per la richiesta di cancellazione account — e
 * non devono cambiare quando cambia il resto del sito.
 *
 * La base URL arriva da `EXPO_PUBLIC_SITE_URL` (senza slash finale). Finché
 * quella variabile non è impostata ovunque (`.env`, EAS, `vars` di GitHub) si
 * ripiega su `EXPO_PUBLIC_REVIEW_SITE_URL`, che punta allo stesso host: prima
 * le pagine stavano dentro `web-review/`, che occupava la radice.
 */
const SITE_URL =
  process.env.EXPO_PUBLIC_SITE_URL ??
  process.env.EXPO_PUBLIC_REVIEW_SITE_URL ??
  "http://localhost:8080";

export const LEGAL_URLS = {
  privacy: `${SITE_URL}/privacy.html`,
  accountDeletion: `${SITE_URL}/elimina-account.html`,
} as const;
