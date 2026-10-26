import type { AbsenceWindow } from "@/features/absences/conflicts";
import { absenceCellLabel } from "@/features/absences/labels";
import { addDaysToDate, startOfWeek } from "@/lib/format";
import type { ShiftClash } from "./moveImpact";

/**
 * Lo stesso turno su più giorni della settimana («anche giovedì e sabato»), e
 * gli avvisi sulle persone da mettere in turno in quei giorni.
 *
 * Condiviso da app e dashboard: fino al 26/10/2026 la ripetizione esisteva
 * solo nel pannello web, con queste regole scritte lì dentro. Le frasi stanno
 * qui perché le due strade devono dire la stessa cosa.
 */

/** Un'assenza che tocca uno dei giorni pianificati. */
export type AbsenceHit = { date: string; absence: AbsenceWindow };

/**
 * I sette giorni (lun–dom) della settimana di `date`: è lì che si ripete un
 * turno di servizio, non a distanza di mesi.
 */
export function weekOf(date: string): string[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDaysToDate(monday, i));
}

/** La riga sotto i giorni da ripetere. */
export function repeatHint(extraCount: number): string {
  return extraCount === 0
    ? "Stessi orari, staff e fabbisogno su più giorni della settimana."
    : `Verranno creati ${extraCount + 1} turni identici, uno per giorno.`;
}

/** Tutti i giorni su cui nascerà il turno: la data e le ripetizioni, in ordine. */
export function plannedDatesOf(date: string, extraDates: string[]): string[] {
  return [date, ...extraDates.filter((d) => d !== date)].sort();
}

const DAY_NAME = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
const DAY_NUM = new Intl.DateTimeFormat("it-IT", { day: "numeric" });

/** «gio 1». */
export function shortDay(date: string): { name: string; num: string } {
  const d = new Date(`${date}T00:00:00`);
  return { name: DAY_NAME.format(d), num: DAY_NUM.format(d) };
}

/** «gio 1, ven 2». */
export function shortDays(dates: string[]): string {
  return dates
    .map((d) => {
      const { name, num } = shortDay(d);
      return `${name} ${num}`;
    })
    .join(", ");
}

/**
 * La riga arancione sotto il nome. Su un giorno solo l'etichetta del planning;
 * su più giorni anche quali, raggruppati per etichetta:
 * «Non disponibile gio 1, ven 2 · Assenza richiesta mer 30».
 */
export function absenceHitsLabel(
  hits: AbsenceHit[],
  manyDays: boolean
): string | null {
  if (!hits.length) return null;
  if (!manyDays) return absenceCellLabel(hits[0].absence);
  const byLabel = new Map<string, string[]>();
  for (const h of hits) {
    const label = absenceCellLabel(h.absence);
    byLabel.set(label, [...(byLabel.get(label) ?? []), h.date]);
  }
  return [...byLabel]
    .map(([label, days]) => `${label} ${shortDays(days)}`)
    .join(" · ");
}

/**
 * La riga sotto il nome di chi lavora già in quell'orario: «Già in turno
 * 18:00–23:00 · Sera», oppure su più giorni «Già in turno gio 16, sab 18».
 */
export function clashLabel(
  clashes: ShiftClash[],
  manyDays: boolean
): string | null {
  if (!clashes.length) return null;
  if (!manyDays) {
    const [c] = clashes;
    return `Già in turno ${c.range} · ${c.title}`;
  }
  return `Già in turno ${shortDays(clashes.map((c) => c.date))}`;
}

/**
 * In creazione, i giorni in cui ciascuna persona scelta resta fuori: quelli
 * con un'assenza approvata. Una richiesta ancora da decidere non toglie
 * nessuno: resta l'avviso. La chiave è `id` (la scheda di sede).
 */
export function skippedDaysOf<M extends { id: string }>(
  selected: M[],
  hitsFor: (member: M) => AbsenceHit[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of selected) {
    const days = hitsFor(m)
      .filter((h) => h.absence.status === "approved")
      .map((h) => h.date);
    if (days.length) out.set(m.id, days);
  }
  return out;
}

/**
 * Chi entra nella copia del turno di `date`: tutti, tranne chi quel giorno
 * resta fuori per un'assenza — a meno che il titolare non l'abbia forzato.
 */
export function staffForDate<S extends { venue_member_id: string }>(
  staff: S[],
  date: string,
  skipped: Map<string, string[]>,
  forced: Set<string>
): S[] {
  return staff.filter(
    (p) =>
      forced.has(p.venue_member_id) ||
      !skipped.get(p.venue_member_id)?.includes(date)
  );
}

/** La frase su chi resta fuori, e il comando per cambiarla. */
export function skippedNote(
  name: string,
  days: string[],
  forced: boolean
): { text: string; action: string } {
  const list = shortDays(days);
  return forced
    ? {
        text: `${name} è in turno anche ${list}, nonostante l'assenza approvata.`,
        action: "Lascia fuori",
      }
    : {
        text: `${name} resta fuori ${list}: non è disponibile.`,
        action: "Metti in turno comunque",
      };
}
