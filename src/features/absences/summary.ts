// Il riepilogo mensile delle assenze, dalla riga della RPC all'export.
//
// Modulo **puro**, come `features/assignments/hoursSummary.ts`: lo importa anche
// `src/lib/exportBuilders.ts`, che è condiviso con la dashboard web.

/** Una riga di `get_workspace_absence_summary`: le assenze approvate di una persona.
 * `person_id` è il member id (`workspace_members.id`); i nomi restano quelli di prima per l'export. */
export type AbsenceSummaryRow = {
  person_id: string;
  person_name: string;
  /** Giorni di calendario, tagliati sul mese. */
  ferie_days: number;
  /** Permessi a giornata intera, in giorni. */
  permesso_days: number;
  /** Permessi a ore, in ore. */
  permesso_hours: number;
  malattia_days: number;
  /** Crediti espliciti, al netto dei giorni con lavoro approvato. */
  ferie_hours: number;
  malattia_hours: number;
  permesso_recognized_hours: number;
  /** Crediti esclusi dai totali finché il conflitto non è risolto. */
  conflict_hours: number;
  /** I riferimenti dei certificati medici, già uniti ("123, 456"). */
  inps_protocols: string | null;
};

/**
 * Perché i giorni sono di calendario. Va scritto nella pagina e nell'export:
 * senza, «5 giorni di ferie» da lunedì a venerdì e da venerdì a martedì
 * sembrerebbero la stessa cosa, e per la busta paga non lo sono.
 */
export const ABSENCE_SUMMARY_NOTE =
  "Giorni di calendario, compresi sabati, domeniche e festivi. Le ore riconosciute sono solo quelle indicate per giorno o per un permesso orario approvato; i giorni senza ore restano da quantificare. I crediti in conflitto con ore lavorate sono esclusi dal totale e segnalati da verificare.";

/** "3 gg", "2,5 h", "—". */
export function formatSummaryDays(days: number): string {
  return days > 0 ? `${days} ${days === 1 ? "g" : "gg"}` : "—";
}
