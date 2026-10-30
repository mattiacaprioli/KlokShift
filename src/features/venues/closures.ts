import type { Tables } from "@/types/database";

/**
 * Giorni di chiusura della sede (`venue_closures`, decisione del 30/10). Le
 * vedono tutti — chi pianifica e chi lavora — nei Turni; un turno in un giorno
 * di chiusura si può creare lo stesso, con un avviso (apertura eccezionale).
 * Solo dati e regole pure: app e dashboard le condividono.
 */
export type VenueClosure = Tables<"venue_closures">;

const dayMonth = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const fmt = (date: string) => dayMonth.format(new Date(`${date}T00:00:00`));

/** Le chiusure di una sede che comprendono quel giorno ("YYYY-MM-DD"). */
export function closuresOn(
  closures: readonly VenueClosure[],
  venueId: string,
  date: string
): VenueClosure[] {
  return closures.filter(
    (c) => c.venue_id === venueId && c.start_date <= date && c.end_date >= date
  );
}

/** «15 ago» o «10 ago – 20 ago». */
export function closureRangeText(c: Pick<VenueClosure, "start_date" | "end_date">): string {
  return c.start_date === c.end_date
    ? fmt(c.start_date)
    : `${fmt(c.start_date)} – ${fmt(c.end_date)}`;
}

/** L'etichetta sul giorno: «Chiusa · Ferragosto», o solo «Chiusa». */
export function closureLabel(c: Pick<VenueClosure, "reason">): string {
  return c.reason ? `Chiusa · ${c.reason}` : "Chiusa";
}

/**
 * L'avviso del form del turno quando una delle date cade in una chiusura della
 * sede scelta. `null` se non c'è niente da dire. Non blocca: lo dice e basta.
 */
export function closureWarning(
  closures: readonly VenueClosure[],
  venueId: string | null | undefined,
  dates: readonly string[],
  /** «creare» nel form nuovo, «spostare» quando si cambia la data. */
  verb: "creare" | "spostare" = "creare"
): string | null {
  if (!venueId) return null;
  const hit = [...new Set(dates)]
    .sort()
    .flatMap((d) => closuresOn(closures, venueId, d).map((c) => ({ d, c })));
  if (hit.length === 0) return null;
  const first = hit[0];
  const why = first.c.reason ? ` (${first.c.reason})` : "";
  const when =
    hit.length === 1 ? `il ${fmt(first.d)}` : `in ${hit.length} dei giorni scelti, dal ${fmt(first.d)}`;
  return `La sede è chiusa ${when}${why}. Puoi ${verb} il turno lo stesso, se è un'apertura eccezionale.`;
}

/** Le chiusure ancora da venire o in corso, in ordine. */
export function upcomingClosures(
  closures: readonly VenueClosure[],
  venueId: string,
  today: string
): VenueClosure[] {
  return closures
    .filter((c) => c.venue_id === venueId && c.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function addDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Tutti i giorni chiusi delle sedi indicate: per segnarli sul calendario. */
export function closedDates(
  closures: readonly VenueClosure[],
  venueIds: readonly string[]
): Set<string> {
  const venues = new Set(venueIds);
  const out = new Set<string>();
  for (const c of closures) {
    if (!venues.has(c.venue_id)) continue;
    for (let d = c.start_date; d <= c.end_date; d = addDay(d)) out.add(d);
  }
  return out;
}

/**
 * Cosa dire di un giorno: «Chiusa · Ferragosto», o con più sedi
 * «Milano chiusa · Ferragosto». `null` se nessuna delle sedi è chiusa.
 */
export function dayClosureText(
  closures: readonly VenueClosure[],
  venues: readonly { id: string; name: string }[],
  date: string
): string | null {
  const parts = venues.flatMap((v) =>
    closuresOn(closures, v.id, date).map((c) =>
      venues.length > 1
        ? `${v.name} chiusa${c.reason ? ` · ${c.reason}` : ""}`
        : closureLabel(c)
    )
  );
  return parts.length > 0 ? parts.join(" — ") : null;
}
