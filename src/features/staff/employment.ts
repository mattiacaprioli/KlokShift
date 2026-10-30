import type { Enums } from "@/types/database";

/**
 * Cosa cambia fra «Fisso» e «A chiamata», detto sotto la scelta. Le due chip
 * da sole non dicevano niente a chi apriva l'app la prima volta, e la
 * differenza è proprio quella che si vede subito: chi conferma e chi no
 * (migration 20260915100000).
 */
export const EMPLOYMENT_HINT: Record<Enums<"employment_type">, string> = {
  fisso: "Fisso: quando metti la persona in turno, è già confermata.",
  a_chiamata: "A chiamata: la persona riceve il turno e conferma se c'è.",
};
