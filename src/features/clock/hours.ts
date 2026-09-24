import type { Tables } from "@/types/database";

export type ClockCorrection = Tables<"shift_clock_corrections"> & {
  corrector?: { full_name: string | null } | null;
};
export type ClockRecord = Tables<"shift_clock_records">;
export type ClockRecordWithCorrections = ClockRecord & {
  corrections: ClockCorrection[];
};

/** L'audit è append-only: l'ultima correzione non-null prevale per campo. */
export function effectiveClockTimes(record: ClockRecordWithCorrections) {
  const corrections = [...record.corrections].sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : b.created_at.localeCompare(a.created_at)
  );
  return {
    inAt:
      corrections.find((c) => c.corrected_in_at != null)?.corrected_in_at ??
      record.clock_in_at,
    outAt:
      corrections.find((c) => c.corrected_out_at != null)?.corrected_out_at ??
      record.clock_out_at,
  };
}

/** Proposta al quarto d'ora, identica al calcolo della RPC di approvazione. */
export function clockedHours(inAt: string, outAt: string): number {
  const hours = (new Date(outAt).getTime() - new Date(inAt).getTime()) / 3_600_000;
  return Math.round(hours * 4) / 4;
}

export function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}
