import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import { addDaysToDate, isShiftOver } from "@/lib/format";

/**
 * «Duplica settimana/mese»: cosa si copia, cosa resta fuori e perché. Le regole
 * e le frasi stanno qui perché le usano il dialogo della dashboard
 * (`DuplicatePeriodDialog`) e la finestra dell'app (`DuplicateWeekModal`):
 * fino al 27/10/2026 la copia esisteva solo sul web. Nessun import di React
 * Native.
 */

/** Solo i campi che servono a decidere e a mostrare l'anteprima. */
export type DuplicateSource = {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  /** Il fuori turno nasce da una timbratura: non è un turno da ripetere. */
  unplanned?: boolean;
  /** Se c'è, serve solo a contare quante notifiche partiranno. */
  shift_assignments?: { status: AssignmentStatus }[];
};

/** Oltre questa soglia la copia smette di essere un gesto e diventa un impegno. */
export const DUPLICATE_BULK_WARN = 30;

/**
 * Data di origine → data di destinazione, con la regola che decide chi chiama
 * (sette giorni per settimana; sul mese la stessa posizione). Una data senza
 * posto (`null`, il 5° venerdì) resta fuori dalla mappa.
 */
export function duplicateDateMap(
  shifts: Pick<DuplicateSource, "date">[],
  mapDate: (date: string) => string | null
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of shifts) {
    if (map[s.date]) continue;
    const to = mapDate(s.date);
    if (to) map[s.date] = to;
  }
  return map;
}

/** La mappa della settimana: tutto avanti di `weeks` settimane. */
export function weekDateMap(
  shifts: Pick<DuplicateSource, "date">[],
  weeks: number
): Record<string, string> {
  return duplicateDateMap(shifts, (date) => addDaysToDate(date, weeks * 7));
}

/**
 * Copiabili: i turni ancora validi che hanno una data dove andare e che lì
 * non sarebbero già finiti (il passato non si pianifica, `create_shifts` lo
 * rifiuta). Un annullato non si duplica — ricreerebbe proprio quello che il
 * gestore aveva tolto — e nemmeno un fuori turno, che non era pianificato.
 */
export function classifyDuplicate<S extends DuplicateSource>(
  shifts: S[],
  dateMap: Record<string, string>,
  now: Date = new Date()
) {
  const copyable: S[] = [];
  let skippedCancelled = 0;
  let skippedUnplanned = 0;
  let skippedNoSlot = 0;
  let skippedPast = 0;
  let notifications = 0;
  for (const s of shifts) {
    if (s.status === "cancelled") {
      skippedCancelled++;
    } else if (s.unplanned) {
      skippedUnplanned++;
    } else if (!dateMap[s.date]) {
      skippedNoSlot++;
    } else if (
      isShiftOver(
        { date: dateMap[s.date], start_time: s.start_time, end_time: s.end_time },
        now
      )
    ) {
      skippedPast++;
    } else {
      copyable.push(s);
      notifications += (s.shift_assignments ?? []).filter((a) =>
        isActiveAssignment(a.status)
      ).length;
    }
  }
  copyable.sort((a, b) =>
    dateMap[a.date] === dateMap[b.date]
      ? a.start_time.localeCompare(b.start_time)
      : dateMap[a.date].localeCompare(dateMap[b.date])
  );
  return {
    copyable,
    skippedCancelled,
    skippedUnplanned,
    skippedNoSlot,
    skippedPast,
    notifications,
  };
}

export const DUPLICATE_WITH_STAFF_LABEL = "Copia anche le persone assegnate";

export function duplicateWithStaffHint(withStaff: boolean): string {
  return withStaff
    ? "Ognuno riceverà la notifica del nuovo turno. Chi aveva rifiutato o era assente non viene ricopiato."
    : "Copia solo orari e fabbisogno per ruolo: i turni restano da assegnare e nessuno riceve notifiche.";
}

/** «2 turni restano fuori: cadrebbero in giorni già passati…». */
export function duplicateSkippedPastText(count: number): string {
  return `${count === 1 ? "1 turno resta" : `${count} turni restano`} fuori: ${
    count === 1 ? "cadrebbe" : "cadrebbero"
  } in giorni già passati. Un turno già fatto si registra con «+ Già fatto».`;
}

export const DUPLICATE_NOTHING_PAST =
  "I turni da copiare cadrebbero in giorni già passati: non c'è niente da copiare.";

/** «Partiranno 34 notifiche…». */
export function duplicateNotificationsWarning(count: number): string {
  return `Partiranno ${count} notifiche a chi è assegnato. Togli la copia delle persone per copiare solo la griglia e assegnarle dopo.`;
}

/** «La settimana di destinazione ha già 3 turni: questi si aggiungono…». */
export function duplicateTargetExistingText(count: number, isMonth: boolean): string {
  return `${isMonth ? "Il mese" : "La settimana"} di destinazione ha già ${count} ${
    count === 1 ? "turno" : "turni"
  }: questi si aggiungono, non li sostituiscono.`;
}

export function duplicateCreatedToast(count: number, targetLabel: string): string {
  return `${count} ${count === 1 ? "turno copiato" : "turni copiati"} su ${targetLabel}`;
}

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });

/** «26 ott – 1 nov»: la settimana che comincia dal lunedì `monday`. */
export function weekRangeLabel(monday: string): string {
  const from = new Date(`${monday}T00:00:00`);
  const to = new Date(`${addDaysToDate(monday, 6)}T00:00:00`);
  return `${DAY_MONTH.format(from)} – ${DAY_MONTH.format(to)}`;
}
