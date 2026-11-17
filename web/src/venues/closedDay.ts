import type { CSSProperties } from "react";

/**
 * Il giorno in cui la sede è chiusa, uguale in settimana, mese e vista per
 * persona: sfondo spento e un tratteggio leggero, così si riconosce a colpo
 * d'occhio senza usare l'arancio (che nel planning vuol dire «c'è un
 * problema»). L'etichetta col motivo resta accanto.
 */
export const CLOSED_DAY_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-t1) 5%, transparent) 0 6px, transparent 6px 14px)",
};
