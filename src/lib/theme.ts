import { darkColors, type ThemeColors } from "@/constants/colors";

/**
 * I colori del tema corrente per i prop JS (vedi `@/constants/colors`).
 *
 * Oggi c'è solo il tema scuro. Quando arriverà il chiaro, la scelta (sistema o
 * impostazione) si farà qui: i componenti che chiamano `useColors()` seguiranno
 * il tema senza essere toccati.
 */
export function useColors(): ThemeColors {
  return darkColors;
}
