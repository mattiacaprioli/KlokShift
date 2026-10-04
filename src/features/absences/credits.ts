import { addDaysToDate } from "@/lib/format";
import type { Absence, AbsenceHourCredit } from "./api";

/**
 * Le ore riconosciute di un'assenza, giorno per giorno, condivise da app e web.
 *
 * Nessuna conversione implicita (`plans/HOURS-ABSENCES-ADJUSTMENTS.md`): un
 * giorno senza ore resta un giorno. «Stesse ore per tutti» compila il modulo
 * sotto gli occhi di chi lo salva, che può svuotare il sabato prima di salvare:
 * è una scorciatoia di digitazione, non una regola.
 */

/**
 * Chi guarda può indicare le ore di questa assenza? Specchio di
 * `set_absence_hour_credit`: approvata, a giornata intera (il permesso a ore ha
 * già le sue ore), permesso Ore, e un collaboratore mai sulle proprie.
 */
export function canCreditAbsence(
  a: Pick<Absence, "status" | "start_time" | "member_id">,
  me: { canHours: boolean; isOwner: boolean; myMemberId: string | undefined }
): boolean {
  return (
    a.status === "approved" &&
    !a.start_time &&
    me.canHours &&
    (me.isOwner || a.member_id !== me.myMemberId)
  );
}

/** Tutti i giorni dell'assenza, estremi compresi. */
export function absenceDates(
  a: Pick<Absence, "start_date" | "end_date">
): string[] {
  const dates: string[] = [];
  for (let d = a.start_date; d <= a.end_date; d = addDaysToDate(d, 1)) {
    dates.push(d);
  }
  return dates;
}

/**
 * Il testo di un campo ore → minuti. `null` = campo vuoto (nessun credito),
 * `undefined` = non valido. Accetta la virgola; al minuto, fra 0 e 24 ore
 * escluso lo zero, come la RPC.
 */
export function parseCreditHours(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const hours = Number(t.replace(",", "."));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return undefined;
  // 7,1 h × 60 = 425,99999…: l'arrotondamento assorbe solo l'errore binario.
  const minutes = hours * 60;
  return Math.abs(minutes - Math.round(minutes)) < 1e-6
    ? Math.round(minutes)
    : undefined;
}

/** Minuti → «8», «7,5»: il valore del campo, senza unità. */
export function creditHoursText(minutes: number): string {
  return (minutes / 60).toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

/** Minuti → «8 h», «7,5 h». */
export function formatCreditHours(minutes: number): string {
  return `${creditHoursText(minutes)} h`;
}

/** Il modulo appena aperto: le ore già salvate, vuoto il resto. */
export function creditDraftOf(
  dates: readonly string[],
  saved: readonly AbsenceHourCredit[]
): Record<string, string> {
  const byDate = new Map(saved.map((c) => [c.date, c.minutes]));
  const draft: Record<string, string> = {};
  for (const d of dates) {
    const m = byDate.get(d);
    draft[d] = m == null ? "" : creditHoursText(m);
  }
  return draft;
}

/** «Stesse ore per tutti»: riempie solo i giorni ancora vuoti. */
export function fillEmptyCredits(
  draft: Record<string, string>,
  value: string
): Record<string, string> {
  const next = { ...draft };
  for (const d of Object.keys(next)) {
    if (next[d].trim() === "") next[d] = value;
  }
  return next;
}

export type CreditChange = { date: string; minutes: number | null };

/**
 * Le sole differenze fra il modulo e il salvato, da mandare alla RPC; `null` se
 * un campo non è valido (il salvataggio resta spento).
 */
export function creditChanges(
  draft: Record<string, string>,
  saved: readonly AbsenceHourCredit[]
): CreditChange[] | null {
  const byDate = new Map(saved.map((c) => [c.date, c.minutes]));
  const changes: CreditChange[] = [];
  for (const [date, text] of Object.entries(draft)) {
    const minutes = parseCreditHours(text);
    if (minutes === undefined) return null;
    if (minutes !== (byDate.get(date) ?? null)) changes.push({ date, minutes });
  }
  return changes.sort((x, y) => x.date.localeCompare(y.date));
}

/**
 * La riga di riepilogo sulla card: «16 h su 2 giorni di 4», «Ore non
 * indicate». I giorni da verificare (lavoro approvato nello stesso giorno) lo
 * dicono, perché nell'export non vengono contati.
 */
export function creditSummary(
  credits: readonly AbsenceHourCredit[],
  days: number
): string {
  if (credits.length === 0) return "Ore riconosciute non indicate";
  const total = credits.reduce((sum, c) => sum + c.minutes, 0);
  const coverage =
    credits.length === days
      ? days === 1
        ? ""
        : ` su ${days} giorni`
      : ` su ${credits.length} ${credits.length === 1 ? "giorno" : "giorni"} di ${days}`;
  const toCheck = credits.filter((c) => c.conflict).length;
  return `Ore riconosciute · ${formatCreditHours(total)}${coverage}${
    toCheck > 0 ? ` · ${toCheck} da verificare` : ""
  }`;
}
