import { formatDate, formatTime, todayString } from "@/lib/format";
import type { Absence, AbsenceKind, AbsenceStatus } from "./api";

export const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  ferie: "Ferie",
  permesso: "Permesso",
  malattia: "Malattia",
};

export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = {
  pending: "In attesa",
  approved: "Approvata",
  rejected: "Rifiutata",
  withdrawn: "Ritirata",
};

/** L'ordine del selettore nel form. */
export const ABSENCE_KINDS: readonly { id: AbsenceKind; label: string }[] = [
  { id: "ferie", label: ABSENCE_KIND_LABEL.ferie },
  { id: "permesso", label: ABSENCE_KIND_LABEL.permesso },
  { id: "malattia", label: ABSENCE_KIND_LABEL.malattia },
];

/**
 * Stessa frase del lato database, per la persona che legge.
 *
 * ⚠️ Il testo sulla malattia non chiede mai il motivo: al titolare servono solo
 * le date (GDPR art. 9). Lo mostrano sia l'app sia la dashboard.
 */
export const SICK_PRIVACY_HINT =
  "Non scrivere qui informazioni sulla tua salute: al titolare servono solo le date. Il riferimento del certificato medico puoi aggiungerlo anche dopo.";

type AbsenceRange = Pick<
  Absence,
  "start_date" | "end_date" | "start_time" | "end_time"
>;

/** «lun 5 ott», «lun 5 ott – ven 9 ott», «lun 5 ott · 09:00–12:00». */
export function formatAbsenceRange(a: AbsenceRange): string {
  if (a.start_date === a.end_date) {
    const day = formatDate(a.start_date);
    return a.start_time && a.end_time
      ? `${day} · ${formatTime(a.start_time)}–${formatTime(a.end_time)}`
      : day;
  }
  return `${formatDate(a.start_date)} – ${formatDate(a.end_date)}`;
}

/** Giorni di calendario dell'intervallo, estremi compresi. */
export function absenceDays(a: Pick<Absence, "start_date" | "end_date">): number {
  const ms =
    new Date(`${a.end_date}T00:00:00`).getTime() -
    new Date(`${a.start_date}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Il professionista può ancora ritirarla? Specchio di `withdraw_absence`: in
 * sospeso sempre, approvata solo se non è ancora cominciata. Il database resta
 * l'arbitro (usa l'ora di Roma); qui decide solo se mostrare il bottone.
 */
export function canWithdrawAbsence(
  a: Pick<Absence, "status" | "start_date">,
  today: string = todayString()
): boolean {
  if (a.status === "pending") return true;
  return a.status === "approved" && a.start_date > today;
}

/**
 * Le sezioni della pagina Assenze, condivise da app e web:
 * - `pending`: da decidere;
 * - `upcoming`: approvate e non ancora finite, in corso comprese, dalla più
 *   vicina;
 * - `closed`: finite, rifiutate o ritirate, dalla più recente.
 */
export function groupCompanyAbsences<
  T extends Pick<Absence, "status" | "start_date" | "end_date">,
>(
  absences: readonly T[],
  today: string = todayString()
): { pending: T[]; upcoming: T[]; closed: T[] } {
  const pending: T[] = [];
  const upcoming: T[] = [];
  const closed: T[] = [];
  for (const a of absences) {
    if (a.status === "pending") pending.push(a);
    else if (a.status === "approved" && a.end_date >= today) upcoming.push(a);
    else closed.push(a);
  }
  closed.sort((x, y) => y.start_date.localeCompare(x.start_date));
  return { pending, upcoming, closed };
}

/** Il tono della pillola di stato, condiviso da app e web. */
export function absenceStatusTone(
  status: AbsenceStatus
): "pending" | "accepted" | "cancelled" {
  if (status === "pending") return "pending";
  if (status === "approved") return "accepted";
  return "cancelled";
}

/**
 * L'avviso quando si mette in turno una persona assente. Avviso e non blocco,
 * come per le ore da contratto: il titolare può sapere cose che l'app non sa
 * (le ferie spostate a voce).
 *
 * Non dice mai il **tipo** di assenza: chi fa solo i turni non lo deve sapere.
 */
export function absenceWarning(
  name: string,
  a: {
    status: AbsenceStatus;
    start_time: string | null;
    end_time: string | null;
  }
): string {
  const hours =
    a.start_time && a.end_time
      ? ` dalle ${formatTime(a.start_time)} alle ${formatTime(a.end_time)}`
      : "";
  return a.status === "approved"
    ? `${name} non è disponibile${hours || " quel giorno"}: ha un'assenza approvata.`
    : `${name} ha chiesto un'assenza${hours || " per quel giorno"}, ancora da decidere.`;
}

/** L'etichetta breve della cella del planning. */
export function absenceCellLabel(a: {
  status: AbsenceStatus;
  start_time: string | null;
  end_time: string | null;
}): string {
  const base = a.status === "approved" ? "Non disponibile" : "Assenza richiesta";
  return a.start_time && a.end_time
    ? `${base} · ${formatTime(a.start_time)}–${formatTime(a.end_time)}`
    : base;
}

/** La dicitura sul turno del professionista che cade in una sua assenza. */
export const MY_ABSENCE_NOTE: Record<AbsenceKind, string> = {
  ferie: "Sei in ferie",
  permesso: "Sei in permesso",
  malattia: "Sei in malattia",
};
