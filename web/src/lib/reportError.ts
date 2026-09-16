// Segnalazione degli errori della dashboard.
//
// L'app usa @sentry/react-native (src/app/_layout.tsx), che in un bundle Vite
// non è utilizzabile: tira dentro i moduli nativi. Finché la dashboard non ha
// un DSN proprio con @sentry/react, l'errore finisce almeno nella console del
// browser — dove un gestore che chiama può leggerlo — invece di sparire con la
// pagina bianca.
export function reportError(error: unknown, context?: string) {
  console.error(`[KlokShift${context ? ` · ${context}` : ""}]`, error);
}
