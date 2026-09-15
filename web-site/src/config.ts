/*
 * Dove mandano le CTA. La dashboard sta sotto `/app/` nello stesso sito (vedi
 * il workflow di deploy), ma in locale gira sul dev server di Vite: per questo
 * l'URL si può scavalcare con `EXPO_PUBLIC_APP_URL` nel `.env` della root.
 */
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || "./app").replace(/\/$/, "");

// La dashboard usa HashRouter (Pages non fa fallback SPA): il path della
// registrazione vive dopo il `#`.
export const SIGNUP_URL = `${APP_URL}/#/registrati`;
export const LOGIN_URL = `${APP_URL}/#/login`;

/*
 * Le schede store, quando ci saranno (M8). Finché sono vuote i badge restano
 * spenti e la pagina d'invito dice «in arrivo»: il giorno della pubblicazione
 * si valorizzano queste due variabili nel `.env` e i badge si accendono, senza
 * toccare né il copy né il codice.
 *
 * ⚠️ I default in `vite.config.mts` (blocco `define`) non sono facoltativi: una
 * chiave assente dal `.env` non verrebbe sostituita affatto, e `process` nel
 * browser non esiste.
 */
export const IOS_URL = process.env.EXPO_PUBLIC_IOS_URL || "";
export const ANDROID_URL = process.env.EXPO_PUBLIC_ANDROID_URL || "";
