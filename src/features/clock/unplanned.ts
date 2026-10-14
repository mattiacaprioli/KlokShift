import { toTimeString } from "@/lib/format";
import {
  ITALY_TIME_ZONE,
  resolveRomeLocal,
  romeDateTimeLocal,
  type RomeFieldResult,
} from "./timezone";

/** Annullare la timbratura di un fuori turno toglie il turno: lo si dice prima. */
export const UNPLANNED_VOID_NOTICE =
  "È un turno «Fuori turno»: esiste solo per questa timbratura, quindi annullandola viene tolto anche il turno.";

/** Il massimo fra entrata e uscita, come in `close_unplanned_clock`. */
const MAX_OUT_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;

const ROME_TIME = /^(\d{2}):(\d{2})$/;

/**
 * L'uscita scelta con un selettore d'orario (`HH:mm` dell'ora di Roma) per una
 * timbratura senza turno: il primo istante dopo l'entrata in cui a Roma
 * l'orologio segna quell'ora. Le 02:00 scelte per un'entrata delle 22:00 sono
 * quindi la notte dopo, non la mattina prima.
 *
 * Il giorno è quello di Roma, mai quello del dispositivo. Le due notti del
 * cambio d'ora seguono `timezone.ts`: l'ora saltata è un errore, quella ripetuta
 * chiede `ambiguousChoice` solo se tutte e due le volte vengono dopo l'entrata.
 */
export function unplannedOutAt(
  clockInAt: string,
  time: string,
  ambiguousChoice?: 0 | 1
): RomeFieldResult {
  if (!ROME_TIME.test(time)) {
    return { ok: false, reason: "invalid", message: "Orario non valido." };
  }
  const inMs = Date.parse(clockInAt);
  const inWall = romeDateTimeLocal(clockInAt);
  const firstDay = inWall.slice(0, 10);
  for (const day of [firstDay, nextDay(firstDay)]) {
    const resolved = resolveRomeLocal(`${day}T${time}`);
    switch (resolved.kind) {
      case "invalid":
        return { ok: false, reason: "invalid", message: "Orario non valido." };
      case "ok":
        if (Date.parse(resolved.iso) > inMs) return { ok: true, iso: resolved.iso };
        break;
      case "ambiguous": {
        const after = resolved.candidates.filter((iso) => Date.parse(iso) > inMs);
        if (after.length === 1) return { ok: true, iso: after[0] };
        if (after.length === 2) {
          if (ambiguousChoice !== undefined) {
            return { ok: true, iso: after[ambiguousChoice] };
          }
          return {
            ok: false,
            reason: "ambiguous",
            message:
              "Quest'ora si ripete: quella notte gli orologi tornano indietro di un'ora. Scegli quale delle due.",
          };
        }
        break;
      }
      case "skipped":
        // Saltata il giorno dell'entrata ma prima di lei: conta la notte dopo.
        if (day === firstDay && time <= inWall.slice(11)) break;
        return {
          ok: false,
          reason: "skipped",
          message:
            "Quest'ora non esiste: quella notte gli orologi vanno avanti di un'ora. Controlla l'orario.",
        };
    }
  }
  return { ok: false, reason: "invalid", message: "Orario non valido." };
}

/** Il giorno dopo di una data `YYYY-MM-DD`, senza passare dal fuso del dispositivo. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Perché un'uscita non va bene, con le stesse regole di `close_unplanned_clock`:
 * dopo l'entrata, non nel futuro, al massimo 24 ore dopo. `null` se va bene.
 */
export function validateUnplannedOut(
  clockInAt: string,
  outAt: string,
  nowMs: number
): string | null {
  const inMs = Date.parse(clockInAt);
  const outMs = Date.parse(outAt);
  if (outMs <= inMs) return "L’uscita deve essere successiva all’entrata.";
  if (outMs > nowMs) return "L’uscita non può essere nel futuro.";
  if (outMs - inMs > MAX_OUT_MS) {
    return "L’uscita può essere al massimo 24 ore dopo l’entrata.";
  }
  return null;
}

/**
 * L'uscita da proporre: adesso, ma mai oltre 24 ore dall'entrata. Proporre
 * «adesso» per un'entrata dimenticata da più di un giorno offriva un orario che
 * il server rifiuta sempre.
 */
export function defaultUnplannedOut(clockInAt: string, nowMs: number): string {
  return new Date(Math.min(nowMs, Date.parse(clockInAt) + MAX_OUT_MS)).toISOString();
}

/** L'orario di Roma (`HH:mm`) di un istante, per il selettore dell'app. */
export function romeTime(iso: string): string {
  return romeDateTimeLocal(iso).slice(11);
}

/**
 * `TimeField` lavora su un `Date` e ne mostra ore e minuti nel fuso del
 * dispositivo. Qui il `Date` è solo il contenitore di `HH:mm`: si scrive e si
 * rilegge con gli stessi campi e non si usa mai come istante, quindi il fuso
 * del telefono non entra nel conto. Il giorno fisso non ha cambi d'ora.
 */
export function timeToPicker(time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 15, h, m);
}

export function timeFromPicker(picked: Date): string {
  return toTimeString(picked);
}

/**
 * La durata del turno che nascerà, in minuti interi come lo scrive
 * `materialize_unplanned_clock` (entrata e uscita troncate al minuto, almeno uno).
 */
export function formatUnplannedDuration(clockInAt: string, outAt: string): string {
  const minutes = Math.max(
    1,
    Math.floor(Date.parse(outAt) / MINUTE_MS) - Math.floor(Date.parse(clockInAt) / MINUTE_MS)
  );
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const romeDay = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: ITALY_TIME_ZONE,
});

/** Il giorno di Roma di un istante: «gio 10/10». */
export function formatRomeDay(iso: string): string {
  return romeDay.format(new Date(iso));
}
