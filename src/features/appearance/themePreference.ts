/**
 * Il tema scelto dalla persona, condiviso da app e dashboard (2026-11-18).
 *
 * È una preferenza del **dispositivo**, non dell'account: sta in
 * `expo-secure-store` sull'app e in `localStorage` sulla dashboard, come fanno
 * gli strumenti di lavoro più diffusi (lo stesso account può volere il chiaro
 * sul computer dell'ufficio e lo scuro sul telefono la sera).
 *
 * ⚠️ «Automatico» con lo schema del sistema ignoto vale **chiaro**, come i
 * token CSS: `:root` è il chiaro e lo scuro sta sotto
 * `prefers-color-scheme: dark`. Se qui si scegliesse lo scuro, classi e prop JS
 * disegnerebbero due temi diversi.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

export const THEME_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
  { id: "system", label: "Automatico" },
  { id: "light", label: "Chiaro" },
  { id: "dark", label: "Scuro" },
];

export const THEME_STORAGE_KEY = "klokshift.theme";

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ResolvedScheme {
  if (preference !== "system") return preference;
  return system === "dark" ? "dark" : "light";
}

/** La riga sotto la scelta: con «Automatico» dice anche cosa si vede adesso. */
export function themeHint(preference: ThemePreference, resolved: ResolvedScheme): string {
  if (preference !== "system") return "Resta così anche se cambia il sistema.";
  return resolved === "dark"
    ? "Segue il sistema: adesso è scuro."
    : "Segue il sistema: adesso è chiaro.";
}
