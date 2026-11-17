import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";
import { colorScheme as cssColorScheme } from "react-native-css";
import { darkColors, lightColors } from "@/constants/colors";
import {
  resolveScheme,
  type ResolvedScheme,
  type ThemePreference,
} from "@/features/appearance/themePreference";
import {
  loadThemePreference,
  saveThemePreference,
} from "@/features/appearance/themeStorage";

type ThemeState = {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  /** Letta la scelta salvata: prima, lo splash resta su (niente lampo). */
  ready: boolean;
  setPreference: (preference: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeState | null>(null);

/**
 * Il tema dell'app (2026-11-18): Automatico, Chiaro o Scuro.
 *
 * Tre cose devono seguire la stessa scelta, e qui si allineano tutte:
 * - le classi (`bg-bg-0`, `text-gold`…): `react-native-css` legge i token da
 *   `:root` o da `@media (prefers-color-scheme: dark)` in `global.css`;
 * - i prop JS (`useColors()`), che leggono `scheme` da questo contesto;
 * - le parti native (tastiera, interruttori, selettori di data, avvisi), che
 *   seguono `Appearance.setColorScheme`.
 *
 * Lo schema del sistema arriva da `useColorScheme()`; con una scelta esplicita
 * `Appearance.setColorScheme` lo sostituisce, con «Automatico» lo restituisce
 * al sistema (`unspecified`).
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadThemePreference().then((saved) => {
      if (!alive) return;
      setPreferenceState(saved);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Le parti native: un override esplicito, o di nuovo il sistema.
  useEffect(() => {
    try {
      Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
    } catch {
      // Sul web di Expo non c'è: le classi seguono comunque `prefers-color-scheme`.
    }
  }, [preference]);

  const scheme = resolveScheme(preference, system);

  // Le classi e il fondo nativo (dietro tastiera, modali, transizioni).
  useEffect(() => {
    cssColorScheme.set(scheme);
    const bg = scheme === "dark" ? darkColors.bg0 : lightColors.bg0;
    void SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [scheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void saveThemePreference(next);
  }, []);

  const value = useMemo(
    () => ({ preference, scheme, ready, setPreference }),
    [preference, scheme, ready, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** La scelta e come cambiarla, per la riga «Tema» in Impostazioni. */
export function useThemePreference(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemePreference deve essere usato dentro <ThemeProvider />");
  return ctx;
}
