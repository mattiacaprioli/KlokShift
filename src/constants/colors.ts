/**
 * I colori del tema in JS, per i prop che le classi NativeWind non raggiungono:
 * `color=` di Icon/ActivityIndicator, `style` dinamici, opzioni di navigazione,
 * gradienti. Nei componenti si leggono con `useColors()` (`@/lib/theme`), mai
 * importando direttamente `darkColors`: così, quando arriverà il tema chiaro,
 * basterà cambiare il hook.
 *
 * ⚠️ `darkColors` è gemello di `src/global.css` e `web/src/index.css` (@theme):
 * ogni token che esiste anche lì ha lo stesso valore. `lightColors` è la
 * palette chiara, non ancora accesa. Test: `tests/unit/theme/colorTokens.test.ts`
 * (valori gemelli e contrasti minimi in entrambi i temi).
 * Le classi Tailwind (`text-gold`, `bg-bg-card`…) restano la via preferita.
 */
export const darkColors = {
  // Brand — oro caldo
  gold: "#EAB54C",
  goldLight: "#F5C765",
  goldDark: "#C68A34",
  goldInk: "#1A1206", // testo sull'oro
  goldFill: "#EAB54C", // oro come fondo: pulsanti, chip attivi, interruttori
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

/**
 * Tema chiaro (2026-11-18), carta calda al posto del quasi-nero. Regole:
 * - `gold` è l'oro che si LEGGE (testi, icone, indicatori): qui un ambra scuro,
 *   perché #EAB54C su fondo chiaro non arriva a 2:1. L'oro che RIEMPIE
 *   (`goldFill`, gradiente di GoldButton, hover/active del web) resta acceso,
 *   con l'inchiostro scuro sopra come nel tema scuro.
 * - Le carte sono bianche su una pagina appena più scura; `bg2`/`bg3` (cerchi
 *   delle icone, campi, scheletri) scendono di tono invece di salire.
 * - Testi e semantici tengono il contrasto del tema scuro: t1–t3 e i colori
 *   d'accento almeno 4,5:1 sulla pagina, t4 resta il grigio «spento» (~3,4:1).
 * - `wash` si inverte: le velature e i filetti diventano scuri.
 */
export const lightColors: ThemeColors = {
  gold: "#8C600F",
  goldLight: "#F5C765",
  goldDark: "#C68A34",
  goldInk: "#1A1206",
  goldFill: "#EAB54C",
  goldDeep: "#D9A23F",

  bg0: "#F6F2EB",
  bg1: "#FDFBF7",
  bg2: "#EFE9DF",
  bg3: "#E5DDD0",
  bgCard: "#FFFFFF",
  surface: "#FFFFFF",

  t1: "#1E1912",
  t2: "#4A4237",
  t3: "#6B6255",
  t4: "#8A8174",

  success: "#1A7D44",
  warning: "#A35607",
  error: "#C63D28",
  info: "#1A6FC4",

  border: "rgba(58, 42, 20, 0.1)",
  border2: "rgba(58, 42, 20, 0.16)",
  borderGold: "rgba(140, 96, 15, 0.4)",

  wash: "#3A2A14",
  scrim: "#000000",
  white: "#FFFFFF",
};

/** `#RRGGBB` → `rgba(r, g, b, alpha)`: le trasparenze nascono dai token. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`withAlpha: colore non esadecimale ${hex}`);
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
