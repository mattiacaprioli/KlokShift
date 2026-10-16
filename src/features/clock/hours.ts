import type { Tables } from "@/types/database";
import {
  formatBreakMinutes,
  formatHours,
  formatHoursVariance,
  isShiftOver,
  shiftCountedHours,
  type ShiftBreak,
  type ShiftTimes,
} from "@/lib/format";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";

export type ClockCorrection = Tables<"shift_clock_corrections"> & {
  corrector?: { full_name: string | null } | null;
};
export type ClockRecord = Tables<"shift_clock_records">;
export type ClockBreak = Tables<"shift_clock_breaks">;
export type ClockRecordWithCorrections = ClockRecord & {
  corrections: ClockCorrection[];
  breaks: ClockBreak[];
};

/** Dalla più recente: stesso ordine di `private.clock_record_times`. */
function latestFirst(record: ClockRecordWithCorrections): ClockCorrection[] {
  return [...record.corrections].sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : b.created_at.localeCompare(a.created_at)
  );
}

/** L'audit è append-only: l'ultima correzione non-null prevale per campo. */
export function effectiveClockTimes(record: ClockRecordWithCorrections) {
  const corrections = latestFirst(record);
  return {
    inAt:
      corrections.find((c) => c.corrected_in_at != null)?.corrected_in_at ??
      record.clock_in_at,
    outAt:
      corrections.find((c) => c.corrected_out_at != null)?.corrected_out_at ??
      record.clock_out_at,
  };
}

export type ClockBreakSource = "corrected" | "clocked" | "planned";

/**
 * La pausa che vale per una timbratura, in ordine: l'ultima correzione di chi
 * gestisce le ore, la somma delle pause timbrate (tagliate fra entrata e uscita
 * effettive; una pausa ancora aperta conta fino a `now`), la pausa pianificata
 * del turno. ⚠️ Gemello manuale di `private.clock_record_break`
 * (20261016000000): se cambia lì, cambia qui.
 */
export function effectiveClockBreak(
  record: ClockRecordWithCorrections,
  plannedMinutes: number,
  now: Date = new Date()
): { minutes: number; source: ClockBreakSource } {
  const corrected = latestFirst(record).find(
    (c) => c.corrected_break_minutes != null
  );
  if (corrected) {
    return {
      minutes: corrected.corrected_break_minutes as number,
      source: "corrected",
    };
  }
  if (record.breaks.length > 0) {
    const times = effectiveClockTimes(record);
    const from = new Date(times.inAt).getTime();
    const cap = times.outAt ? new Date(times.outAt).getTime() : now.getTime();
    let ms = 0;
    for (const b of record.breaks) {
      const end = Math.min(b.ended_at ? new Date(b.ended_at).getTime() : cap, cap);
      ms += Math.max(0, end - Math.max(new Date(b.started_at).getTime(), from));
    }
    return { minutes: Math.round(ms / 60_000), source: "clocked" };
  }
  return { minutes: plannedMinutes, source: "planned" };
}

const BREAK_SOURCE_LABEL: Record<ClockBreakSource, string> = {
  corrected: "corretta",
  clocked: "timbrata",
  planned: "pianificata",
};

/**
 * «pausa 32 min timbrata, non retribuita»: la stessa frase in app e dashboard
 * accanto alla timbratura. `null` quando non c'è nessuna pausa da dire.
 */
export function clockBreakText(
  pause: { minutes: number; source: ClockBreakSource },
  paid: boolean
): string | null {
  if (pause.minutes <= 0 && pause.source === "planned") return null;
  return `pausa ${formatBreakMinutes(pause.minutes)} ${
    BREAK_SOURCE_LABEL[pause.source]
  }, ${paid ? "retribuita" : "non retribuita"}`;
}

/** La pausa aperta adesso, se il professionista è in pausa. */
export function openClockBreak(
  record: ClockRecordWithCorrections
): ClockBreak | null {
  if (effectiveClockTimes(record).outAt) return null;
  return record.breaks.find((b) => b.ended_at == null) ?? null;
}

/**
 * Proposta al quarto d'ora, identica al calcolo della RPC di approvazione
 * (`private.clock_record_counted_hours`): arco timbrato meno la pausa non
 * retribuita.
 */
export function clockedHours(
  inAt: string,
  outAt: string,
  unpaidBreakMinutes: number = 0
): number {
  const hours =
    (new Date(outAt).getTime() - new Date(inAt).getTime()) / 3_600_000 -
    unpaidBreakMinutes / 60;
  return Math.max(0, Math.round(hours * 4) / 4);
}

/** Le ore proposte da una timbratura chiusa, con la pausa che vale per lei. */
export function clockRecordHours(
  record: ClockRecordWithCorrections,
  shift: ShiftBreak
): number | null {
  const times = effectiveClockTimes(record);
  if (!times.outAt) return null;
  const pause = effectiveClockBreak(record, shift.break_minutes);
  return clockedHours(
    times.inAt,
    times.outAt,
    shift.break_paid ? 0 : pause.minutes
  );
}

/**
 * Il consuntivo di un'assegnazione, confrontabile con le ore programmate.
 *
 * - `approved`: definitivo, conta nel riepilogo mensile;
 * - `proposed`: timbratura completa che aspetta la revisione;
 * - `untracked`: ore scritte su un turno che non si rileva in Manuale e senza
 *   timbratura approvata — il riepilogo le esclude e le mette «da verificare»;
 * - `missing_out`: entrata senza uscita a turno finito.
 *
 * Né `proposed` né `untracked` si presentano mai come ore lavorate. Il Manuale
 * automatico (nessuna ora scritta, nessuna timbratura) non ha un consuntivo da
 * affiancare: il suo numero è il programmato, già mostrato.
 *
 * Fonte unica per planning per persona e storico dei turni: sullo stesso turno
 * devono dire lo stesso numero, e la stessa cosa del riepilogo mensile.
 */
export type AssignmentActual =
  | { kind: "approved" | "proposed" | "untracked"; hours: number }
  | { kind: "missing_out" }
  | null;

type ActualInput = {
  status: AssignmentStatus;
  worked_hours: number | null;
  /** `shift_assignments.hours_source`: il metodo con cui il turno si è svolto. */
  hours_source: string | null;
  attendance_reviewed_at: string | null;
  clock: ClockRecordWithCorrections | null;
};

/**
 * `worked_hours` è definitivo? Gemello **manuale** del ramo esplicito di
 * `approved_hours` in `get_workspace_hours_summary` (20261004000100): ore del
 * metodo Manuale, oppure di una timbratura approvata e chiusa. Se cambia lì,
 * cambia qui.
 */
export function isDefinitiveWorkedHours(assignment: ActualInput): boolean {
  if (assignment.worked_hours == null) return false;
  if (assignment.hours_source === "manual") return true;
  return (
    assignment.clock != null &&
    assignment.attendance_reviewed_at != null &&
    effectiveClockTimes(assignment.clock).outAt != null
  );
}

export function assignmentActual(
  shift: ShiftTimes & ShiftBreak,
  assignment: ActualInput,
  now: Date = new Date()
): AssignmentActual {
  if (!isActiveAssignment(assignment.status)) return null;
  if (isDefinitiveWorkedHours(assignment)) {
    return { kind: "approved", hours: assignment.worked_hours as number };
  }
  if (assignment.clock) {
    const hours = clockRecordHours(assignment.clock, shift);
    if (hours != null) {
      return { kind: "proposed", hours };
    }
    // Prima della fine prevista un'entrata aperta è normale.
    return isShiftOver(shift, now) ? { kind: "missing_out" } : null;
  }
  if (assignment.worked_hours != null) {
    return { kind: "untracked", hours: assignment.worked_hours };
  }
  return null;
}

/** Il testo del consuntivo accanto al turno, uguale in app e dashboard. */
export function actualChipText(
  actual: NonNullable<AssignmentActual>,
  plannedHours: number
): string {
  if (actual.kind === "missing_out") return "Uscita mancante";
  const label = {
    approved: "Effettive",
    proposed: "Proposte",
    untracked: "Senza timbratura",
  }[actual.kind];
  const delta = formatHoursVariance(actual.hours - plannedHours);
  return `${label} ${formatHours(actual.hours)}${delta ? ` · ${delta}` : ""}${
    actual.kind === "approved" ? "" : " · da verificare"
  }`;
}

/**
 * Timbratura completa, da approvare, con esattamente le ore del turno: è il caso
 * normale, quello che si approva in blocco. La proposta è già al quarto d'ora
 * (`clockedHours`), quindi qualche minuto di anticipo o ritardo resta «in
 * orario»; tutto il resto chiede un'occhiata persona per persona. Il confronto è
 * fra ore conteggiate: una pausa non retribuita più corta o più lunga della
 * pianificata cambia le ore, e la timbratura esce dal blocco da sola.
 */
export function isRegularPendingClock(
  shift: Pick<ShiftTimes, "start_time" | "end_time"> & ShiftBreak,
  assignment: {
    status: AssignmentStatus;
    attendance_reviewed_at: string | null;
    clock: ClockRecordWithCorrections | null;
  }
): boolean {
  if (!isActiveAssignment(assignment.status)) return false;
  if (!assignment.clock || assignment.attendance_reviewed_at != null) {
    return false;
  }
  const hours = clockRecordHours(assignment.clock, shift);
  return hours != null && hours === shiftCountedHours(shift);
}

export type HoursDeviation = {
  name: string;
  /** Ore effettive meno ore del turno: `+1` è un'ora in più. */
  delta: number;
  /** Solo `approved` è definitivo: gli altri si mostrano in colore d'avviso. */
  kind: "approved" | "proposed" | "untracked";
};

/**
 * Chi, in un turno, si è discostato dall'orario: **per persona**, mai come
 * somma. Una somma direbbe «+1 h» senza dire di chi, e un'ora in più di uno
 * più un'ora in meno di un altro darebbe zero: il turno sembrerebbe a posto
 * proprio quando ci sono due cose da guardare.
 *
 * `measured` conta le persone con un consuntivo: zero vuol dire che non c'è
 * niente da confrontare, non che sono tutti in orario.
 */
export function shiftDeviations(
  shift: ShiftTimes &
    ShiftBreak & {
    shift_assignments: (Parameters<typeof assignmentActual>[1] & {
      staff_member: { display_name: string } | null;
    })[];
  },
  now: Date = new Date()
): { measured: number; deviations: HoursDeviation[] } {
  const planned = shiftCountedHours(shift);
  let measured = 0;
  const deviations: HoursDeviation[] = [];
  for (const assignment of shift.shift_assignments) {
    const actual = assignmentActual(shift, assignment, now);
    if (!actual || actual.kind === "missing_out") continue;
    measured += 1;
    const delta = actual.hours - planned;
    if (Math.abs(delta) < 0.001) continue;
    deviations.push({
      name: assignment.staff_member?.display_name || "Professionista",
      delta,
      kind: actual.kind,
    });
  }
  return { measured, deviations };
}

export function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}
