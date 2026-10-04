// Orario civile italiano ↔ istante, per i campi `datetime-local` delle correzioni.
//
// Modulo **puro**: nessun import di Supabase, Expo o React. Il fuso è sempre
// Europe/Rome, mai quello del browser: chi corregge una timbratura da Londra
// scrive l'ora che segnava l'orologio della sede.
//
// ⚠️ Due notti l'anno l'orario civile non corrisponde a un solo istante: a fine
// marzo le 02:00–02:59 non esistono, a fine ottobre si ripetono due volte.
// Qui non si indovina: l'ora saltata è un errore, quella ripetuta chiede una
// scelta. Nessuna correzione «+1 ora» per date particolari — gli offset si
// ricavano da Intl, quindi valgono anche se le regole cambiassero.

export const ITALY_TIME_ZONE = "Europe/Rome";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ITALY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** L'orario che segnava l'orologio a Roma in quell'istante, come campi numerici. */
function romeWallParts(ms: number) {
  const parts = formatter.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Un istante come valore di `<input type="datetime-local">` nell'ora di Roma. */
export function romeDateTimeLocal(iso: string): string {
  const p = romeWallParts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Di quanti ms l'orario di Roma è avanti rispetto a UTC in quell'istante. */
function romeOffsetMs(ms: number): number {
  const p = romeWallParts(ms);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return wall - Math.floor(ms / 60_000) * 60_000;
}

export type RomeLocalResolution =
  | { kind: "ok"; iso: string }
  /** L'ora non esiste: quella notte gli orologi sono andati avanti. */
  | { kind: "skipped" }
  /** L'ora c'è stata due volte: i due istanti, in ordine cronologico. */
  | { kind: "ambiguous"; candidates: [string, string] }
  | { kind: "invalid" };

const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Tutti gli istanti in cui a Roma l'orologio ha segnato `value` (YYYY-MM-DDTHH:mm). */
export function resolveRomeLocal(value: string): RomeLocalResolution {
  const match = LOCAL_VALUE.exec(value);
  if (!match) return { kind: "invalid" };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return { kind: "invalid" };
  }

  // Gli offset possibili sono quelli in vigore mezza giornata prima e dopo:
  // nessun cambio d'ora è così vicino a un altro. Si tengono solo gli istanti
  // che riletti a Roma danno esattamente l'orario scritto.
  const DAY_HALF = 12 * 3_600_000;
  const offsets = new Set([romeOffsetMs(wall - DAY_HALF), romeOffsetMs(wall + DAY_HALF)]);
  const instants = [...offsets]
    .map((offset) => wall - offset)
    .filter((ms) => romeDateTimeLocal(new Date(ms).toISOString()) === value)
    .sort((a, b) => a - b)
    .map((ms) => new Date(ms).toISOString());

  if (instants.length === 0) return { kind: "skipped" };
  if (instants.length === 1) return { kind: "ok", iso: instants[0] };
  return { kind: "ambiguous", candidates: [instants[0], instants[1]] };
}

export type RomeFieldResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "invalid" | "skipped" | "ambiguous"; message: string };

/**
 * Il valore di un campo del form, pronto da salvare.
 *
 * - Campo non toccato (`originalIso` riletto dà lo stesso valore): torna
 *   l'istante originale, secondi compresi — anche nell'ora ripetuta di ottobre,
 *   dove riconvertire sceglierebbe a caso una delle due.
 * - Ora ripetuta nuova: serve `ambiguousChoice` (0 = la prima volta, 1 = la seconda).
 */
export function romeFieldToIso(
  value: string,
  opts: { originalIso?: string | null; ambiguousChoice?: 0 | 1 } = {}
): RomeFieldResult {
  if (opts.originalIso && romeDateTimeLocal(opts.originalIso) === value) {
    return { ok: true, iso: opts.originalIso };
  }
  const resolved = resolveRomeLocal(value);
  switch (resolved.kind) {
    case "ok":
      return { ok: true, iso: resolved.iso };
    case "ambiguous":
      if (opts.ambiguousChoice !== undefined) {
        return { ok: true, iso: resolved.candidates[opts.ambiguousChoice] };
      }
      return {
        ok: false,
        reason: "ambiguous",
        message: "Quest'ora si ripete: quella notte gli orologi tornano indietro di un'ora. Scegli quale delle due.",
      };
    case "skipped":
      return {
        ok: false,
        reason: "skipped",
        message: "Quest'ora non esiste: quella notte gli orologi vanno avanti di un'ora. Controlla l'orario.",
      };
    case "invalid":
      return { ok: false, reason: "invalid", message: "Data e ora non valide." };
  }
}
