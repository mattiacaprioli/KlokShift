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
