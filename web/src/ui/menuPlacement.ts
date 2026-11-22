/**
 * Dove aprire il menu di un Select: sotto al controllo se c'è spazio,
 * altrimenti sopra quando sopra ce n'è di più. Senza questo, un Select in
 * fondo alla finestra apriva il menu fuori dallo schermo.
 */
export type MenuPlacement = { top: number; maxHeight: number; above: boolean };

export function menuPlacement(
  trigger: { top: number; bottom: number },
  viewportHeight: number,
  contentHeight: number,
  gutter = 8
): MenuPlacement {
  const wanted = Math.min(contentHeight, 256);
  const below = viewportHeight - trigger.bottom - gutter * 2;
  const above = trigger.top - gutter * 2;
  if (below >= wanted || below >= above) {
    return { top: trigger.bottom + gutter, maxHeight: Math.max(0, below), above: false };
  }
  const height = Math.min(wanted, above);
  return { top: trigger.top - gutter - height, maxHeight: height, above: true };
}
