import { toDateString } from "@/lib/format";

/** Lunedì della settimana che contiene `d` (settimana IT: lun–dom). */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  // getDay(): 0=dom … 6=sab → offset per tornare a lunedì.
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** I 7 giorni della settimana come date DB (`YYYY-MM-DD`). */
export function weekDays(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => toDateString(addDays(monday, i)));
}

const DAY_LABEL = new Intl.DateTimeFormat("it-IT", { weekday: "short" });
const DAY_NUM = new Intl.DateTimeFormat("it-IT", { day: "numeric" });
const MONTH_YEAR = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

export function dayLabel(dateStr: string): { name: string; num: string } {
  const d = new Date(`${dateStr}T00:00:00`);
  return { name: DAY_LABEL.format(d), num: DAY_NUM.format(d) };
}

/** "3 – 9 novembre 2026" oppure "27 ottobre – 2 novembre 2026". */
export function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const left = sameMonth
    ? DAY_NUM.format(monday)
    : `${DAY_NUM.format(monday)} ${new Intl.DateTimeFormat("it-IT", {
        month: "long",
      }).format(monday)}`;
  return `${left} – ${DAY_NUM.format(sunday)} ${MONTH_YEAR.format(sunday)}`;
}

export function isToday(dateStr: string): boolean {
  return dateStr === toDateString(new Date());
}

// --- Vista mese -----------------------------------------------------------

export function startOfMonth(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), 1);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * I giorni della griglia mensile: settimane intere lun–dom, quindi si parte dal
 * lunedì della settimana che contiene il 1° e si arriva alla domenica di quella
 * che contiene l'ultimo giorno. Sono 35 o 42 caselle, non 28-31.
 */
export function monthGridDays(monthStart: Date): string[] {
  const first = startOfWeek(monthStart);
  const lastDay = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0
  );
  const last = addDays(startOfWeek(lastDay), 6);
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(toDateString(d));
  return out;
}

/** I giorni del mese **vero** (1 → ultimo), non delle settimane che lo contengono. */
export function monthDays(monthStart: Date): string[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) =>
    toDateString(new Date(year, month, i + 1))
  );
}

/**
 * La stessa **posizione nel mese**: il 2° martedì di settembre diventa il 2°
 * martedì di ottobre.
 *
 * È la regola giusta per un turnario, ed è la stessa del "duplica settimana":
 * un turno del venerdì deve ricadere di venerdì — il sabato sera di una sede
 * non somiglia al martedì. Tenere invece il giorno del mese (15 → 15) sposta i
 * turni di weekend in mezzo alla settimana.
 *
 * `null` quando quella posizione nel mese di destinazione non esiste: il 5°
 * venerdì c'è in qualche mese e in altri no. Chi chiama lo conta e lo dice.
 */
export function sameWeekdaySlot(
  dateStr: string,
  targetMonth: Date
): string | null {
  const d = new Date(`${dateStr}T00:00:00`);
  // 0-based: il 1°–7° del mese è la prima occorrenza del suo giorno, l'8°–14° la
  // seconda, e così via.
  const occurrence = Math.floor((d.getDate() - 1) / 7);
  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const offset = (d.getDay() - firstWeekday + 7) % 7;
  const out = new Date(year, month, 1 + offset + occurrence * 7);
  return out.getMonth() === month ? toDateString(out) : null;
}

export function isSameMonth(dateStr: string, monthStart: Date): boolean {
  return dateStr.slice(0, 7) === toDateString(monthStart).slice(0, 7);
}

/** "novembre 2026" */
export function monthTitle(d: Date): string {
  return MONTH_YEAR.format(d);
}

/** Nomi brevi dei giorni per l'intestazione della griglia mensile. */
export const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) =>
  DAY_LABEL.format(addDays(startOfWeek(new Date()), i))
);

/** Mesi come "YYYY-MM" per il selettore del riepilogo ore. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return MONTH_YEAR.format(new Date(y, m - 1, 1));
}
