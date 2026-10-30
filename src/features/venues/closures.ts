import type { Tables } from "@/types/database";

/**
 * Giorni di chiusura della sede (decisione del 30/10). Le vedono tutti — chi
 * pianifica e chi lavora — nei Turni; un turno in un giorno di chiusura si può
 * creare lo stesso, con un avviso (apertura eccezionale).
 *
 * Tre modi di essere chiusa:
 * - una chiusura una tantum (`venue_closures`, dal… al…);
 * - una chiusura **ogni anno** (`repeat_yearly`): Ferragosto, Natale, la
 *   chiusura estiva, confrontate per giorno e mese anche a cavallo d'anno;
 * - il **riposo settimanale** (`venues.rest_days`, ISO 1 = lunedì … 7 = domenica).
 *
 * ⚠️ `closureCovers` è gemello **manuale** del confronto annuale descritto in
 * `20261030000300_venue_closures.sql`. Solo dati e regole pure: app e dashboard
 * le condividono.
 */
export type VenueClosure = Tables<"venue_closures">;

/** Quello che serve per sapere se una sede è chiusa: chiusure e riposi. */
export type VenueCalendar = {
  closures: VenueClosure[];
  /** Per sede, i giorni di riposo settimanale (ISO 1–7). */
  restDays: Record<string, number[]>;
};

export const EMPTY_CALENDAR: VenueCalendar = { closures: [], restDays: {} };

/** Lunedì, martedì… nell'ordine ISO, per le chip del riposo. */
export const WEEKDAYS: { iso: number; short: string; long: string }[] = [
  { iso: 1, short: "L", long: "lunedì" },
  { iso: 2, short: "M", long: "martedì" },
  { iso: 3, short: "M", long: "mercoledì" },
  { iso: 4, short: "G", long: "giovedì" },
  { iso: 5, short: "V", long: "venerdì" },
  { iso: 6, short: "S", long: "sabato" },
  { iso: 7, short: "D", long: "domenica" },
];

const dayMonth = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const fmt = (date: string) => dayMonth.format(new Date(`${date}T00:00:00`));

function isoDay(date: string): number {
  const d = new Date(`${date}T00:00:00`).getDay();
  return d === 0 ? 7 : d;
}

function addDay(date: string, n = 1): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** La chiusura comprende quel giorno? Le annuali per giorno e mese. */
export function closureCovers(
  c: Pick<VenueClosure, "start_date" | "end_date" | "repeat_yearly">,
  date: string
): boolean {
  if (!c.repeat_yearly) return c.start_date <= date && c.end_date >= date;
  const md = date.slice(5);
  const from = c.start_date.slice(5);
  const to = c.end_date.slice(5);
  // Stesso anno (10/08 – 20/08) o a cavallo d'anno (24/12 – 06/01).
  return c.start_date.slice(0, 4) === c.end_date.slice(0, 4)
    ? md >= from && md <= to
    : md >= from || md <= to;
}

type DayClosure = { reason: string | null; rest: boolean };

/** Perché quella sede è chiusa quel giorno: chiusure, poi riposo settimanale. */
export function closuresOn(cal: VenueCalendar, venueId: string, date: string): DayClosure[] {
  const out: DayClosure[] = cal.closures
    .filter((c) => c.venue_id === venueId && closureCovers(c, date))
    .map((c) => ({ reason: c.reason, rest: false }));
  if ((cal.restDays[venueId] ?? []).includes(isoDay(date))) {
    out.push({ reason: "riposo settimanale", rest: true });
  }
  return out;
}

/** «15 ago», «10 ago – 20 ago», con «ogni anno» se si ripete. */
export function closureRangeText(
  c: Pick<VenueClosure, "start_date" | "end_date" | "repeat_yearly">
): string {
  const range =
    c.start_date === c.end_date ? fmt(c.start_date) : `${fmt(c.start_date)} – ${fmt(c.end_date)}`;
  return c.repeat_yearly ? `${range} · ogni anno` : range;
}

function label(d: DayClosure): string {
  return d.reason ? `Chiusa · ${d.reason}` : "Chiusa";
}

/**
 * Cosa dire di un giorno: «Chiusa · Ferragosto», o con più sedi
 * «Milano chiusa · Ferragosto». `null` se nessuna delle sedi è chiusa.
 */
export function dayClosureText(
  cal: VenueCalendar,
  venues: readonly { id: string; name: string }[],
  date: string
): string | null {
  const parts = venues.flatMap((v) => {
    const first = closuresOn(cal, v.id, date)[0];
    if (!first) return [];
    return [
      venues.length > 1
        ? `${v.name} chiusa${first.reason ? ` · ${first.reason}` : ""}`
        : label(first),
    ];
  });
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * I giorni chiusi delle sedi indicate in un intervallo, per il calendario.
 * `includeRest: false` lascia fuori il riposo settimanale: nella lista dei turni
 * un «Chiusa» ogni lunedì sarebbe rumore, sul calendario no.
 */
export function closedDates(
  cal: VenueCalendar,
  venueIds: readonly string[],
  from: string,
  to: string,
  includeRest = true
): Set<string> {
  const out = new Set<string>();
  for (let d = from; d <= to; d = addDay(d)) {
    const day = d;
    if (venueIds.some((v) => closuresOn(cal, v, day).some((x) => includeRest || !x.rest))) {
      out.add(day);
    }
  }
  return out;
}

/**
 * L'avviso del form del turno quando una delle date cade in una chiusura della
 * sede scelta. `null` se non c'è niente da dire. Non blocca: lo dice e basta.
 */
export function closureWarning(
  cal: VenueCalendar,
  venueId: string | null | undefined,
  dates: readonly string[],
  /** «creare» nel form nuovo, «spostare» quando si cambia la data. */
  verb: "creare" | "spostare" = "creare"
): string | null {
  if (!venueId) return null;
  const hit = [...new Set(dates)]
    .sort()
    .flatMap((d) => {
      const first = closuresOn(cal, venueId, d)[0];
      return first ? [{ d, c: first }] : [];
    });
  if (hit.length === 0) return null;
  const first = hit[0];
  const why = first.c.reason ? ` (${first.c.reason})` : "";
  const when =
    hit.length === 1 ? `il ${fmt(first.d)}` : `in ${hit.length} dei giorni scelti, dal ${fmt(first.d)}`;
  return `La sede è chiusa ${when}${why}. Puoi ${verb} il turno lo stesso, se è un'apertura eccezionale.`;
}

/** Le chiusure da mostrare nella scheda: annuali sempre, le altre se non finite. */
export function upcomingClosures(
  closures: readonly VenueClosure[],
  venueId: string,
  today: string
): VenueClosure[] {
  return closures
    .filter((c) => c.venue_id === venueId && (c.repeat_yearly || c.end_date >= today))
    .sort((a, b) => {
      const key = (c: VenueClosure) => (c.repeat_yearly ? `1${c.start_date.slice(5)}` : `0${c.start_date}`);
      return key(a).localeCompare(key(b));
    });
}

/** «Chiusa il lunedì», «Chiusa il lunedì e la domenica». */
export function restDaysText(days: readonly number[]): string | null {
  const names = WEEKDAYS.filter((w) => days.includes(w.iso)).map((w) => w.long);
  if (names.length === 0) return null;
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  return `Riposo settimanale: ${list}`;
}

/** Un intervallo largo attorno a un giorno, per segnare il calendario. */
export function calendarWindow(day: string): { from: string; to: string } {
  return { from: addDay(day, -70), to: addDay(day, 120) };
}
