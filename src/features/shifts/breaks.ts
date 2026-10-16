import { shiftDurationHours } from "@/lib/format";
import type { Tables } from "@/types/database";

/** Le scelte rapide del campo «Pausa»; «Altro» apre i minuti liberi. */
export const BREAK_PRESETS = [0, 15, 30, 45, 60] as const;

/** Lo stesso tetto del vincolo `shifts_break_ck`. */
export const MAX_BREAK_MINUTES = 240;

type BreakRule = Pick<
  Tables<"venues">,
  "break_rule_after_minutes" | "break_rule_minutes"
>;

/**
 * La pausa che la regola della sede propone per un turno: la sua durata se il
 * turno supera la soglia (6 h → scatta da 6 h 01, come Skello), altrimenti
 * nessuna. Precompila il form e basta: chi crea il turno può cambiarla, e la
 * regola non tocca i turni esistenti.
 */
export function suggestedBreakMinutes(
  venue: BreakRule | null | undefined,
  start: string,
  end: string
): number {
  if (!venue?.break_rule_after_minutes || !venue.break_rule_minutes) return 0;
  return shiftDurationHours(start, end) * 60 > venue.break_rule_after_minutes
    ? venue.break_rule_minutes
    : 0;
}

/**
 * L'errore del campo, con le stesse regole di `private.assert_shift_break`;
 * `null` se la pausa va bene.
 */
export function shiftBreakError(
  start: string,
  end: string,
  minutes: number
): string | null {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_BREAK_MINUTES) {
    return `La pausa va da 0 a ${MAX_BREAK_MINUTES} minuti.`;
  }
  if (minutes > 0 && minutes >= shiftDurationHours(start, end) * 60) {
    return "La pausa deve essere più corta del turno.";
  }
  return null;
}

/** Le soglie della regola, in minuti: «oltre 4, 6 o 8 ore». */
export const BREAK_RULE_THRESHOLDS = [240, 360, 480] as const;

/** Le durate della regola, in minuti. */
export const BREAK_RULE_MINUTES = [15, 30, 45, 60] as const;

/** Accendendo la regola: oltre 6 ore, mezz'ora — il caso più comune. */
export const DEFAULT_BREAK_RULE = { afterMinutes: 360, minutes: 30 } as const;

/** Le frasi dell'impostazione, uguali in app e dashboard. */
export const BREAK_POLICY_COPY = {
  paid: "Retribuita: resta nelle ore lavorate. Nell’export compare a parte.",
  unpaid:
    "Non retribuita: si toglie dalle ore lavorate. Nell’export compare a parte.",
  rule: "La regola propone la pausa quando crei un turno; chi lo crea può sempre cambiarla.",
  note: "Vale per i turni non ancora conclusi: quelli già conclusi restano come sono stati registrati. KlokShift non conosce il tuo contratto: verifica con il consulente del lavoro se la pausa va retribuita.",
} as const;
