import * as SecureStore from "expo-secure-store";
import {
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./themePreference";

/**
 * La scelta del tema su questo telefono. Come `viewModeStorage`, sta in
 * `expo-secure-store` perché è lì che l'app tiene le sue comodità locali; a
 * differenza della vista non dipende dall'account (vedi `themePreference.ts`).
 *
 * ⚠️ Solo mobile: la dashboard usa `localStorage` (`web/src/lib/theme.ts`).
 */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    return parseThemePreference(await SecureStore.getItemAsync(THEME_STORAGE_KEY));
  } catch {
    // Illeggibile: si segue il sistema.
    return "system";
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await SecureStore.setItemAsync(THEME_STORAGE_KEY, preference);
  } catch {
    // Non ricordarla costa una scelta al prossimo avvio.
  }
}
