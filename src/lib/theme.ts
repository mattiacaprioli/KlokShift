import { useContext } from "react";
import { useColorScheme } from "react-native";
import { darkColors, lightColors, type ThemeColors } from "@/constants/colors";
import { resolveScheme, type ResolvedScheme } from "@/features/appearance/themePreference";
import { ThemeContext } from "@/providers/Theme";

/**
 * Lo schema in uso (chiaro o scuro), deciso da `ThemeProvider`. Fuori dal
 * provider segue il sistema, con la stessa regola dei token CSS.
 */
export function useScheme(): ResolvedScheme {
  const ctx = useContext(ThemeContext);
  const system = useColorScheme();
  return ctx ? ctx.scheme : resolveScheme("system", system);
}

/**
 * I colori del tema corrente per i prop JS (vedi `@/constants/colors`): i
 * componenti che li leggono da qui seguono il tema senza altro lavoro.
 */
export function useColors(): ThemeColors {
  return useScheme() === "dark" ? darkColors : lightColors;
}
