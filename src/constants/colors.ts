/**
 * I colori del tema in JS, per i prop che le classi NativeWind non raggiungono:
 * `color=` di Icon/ActivityIndicator, `style` dinamici, opzioni di navigazione,
 * gradienti. Nei componenti si leggono con `useColors()` (`@/lib/theme`), mai
 * importando direttamente `darkColors`: così, quando arriverà il tema chiaro,
 * basterà cambiare il hook.
 *
 * ⚠️ Gemello di `src/global.css` e `web/src/index.css` (@theme): ogni token che
 * esiste anche lì ha lo stesso valore (test `tests/unit/colorTokens.test.ts`).
 * Le classi Tailwind (`text-gold`, `bg-bg-card`…) restano la via preferita.
 */
export const darkColors = {
  // Brand — oro caldo
  gold: "#EAB54C",
  goldLight: "#F5C765",
  goldDark: "#C68A34",
  goldInk: "#1A1206", // testo sull'oro
  goldDeep: "#D9A23F", // solo JS: fondo del gradiente di GoldButton

  // Sfondi
  bg0: "#0C0907",
  bg1: "#1F1A13",
  bg2: "#2A241B",
  bg3: "#362E24",
  bgCard: "#17120B",
  surface: "#15110B", // solo JS: pannello flottante (tab bar)

  // Testo
  t1: "#F8F4ED",
  t2: "#C2BBB0",
  t3: "#8C857A",
  t4: "#6A6358",

  // Semantici
  success: "#4FC97D",
  warning: "#E2922F",
  error: "#E55B45",
  info: "#208AEF",

  // Bordi
  border: "rgba(255, 240, 220, 0.07)",
  border2: "rgba(255, 240, 220, 0.12)",
  borderGold: "rgba(234, 181, 76, 0.4)",

  // Solo JS, sempre con `withAlpha`
  wash: "#FFF0DC", // base di velature e filetti sopra lo sfondo
  scrim: "#000000", // fondale dei modali e ombre
  white: "#FFFFFF", // testo su un fondo pieno colorato, riflessi
} as const;

export type ColorToken = keyof typeof darkColors;
export type ThemeColors = { readonly [K in ColorToken]: string };

/** `#RRGGBB` → `rgba(r, g, b, alpha)`: le trasparenze nascono dai token. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`withAlpha: colore non esadecimale ${hex}`);
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
