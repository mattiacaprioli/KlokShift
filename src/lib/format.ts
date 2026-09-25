const dateFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

// date: "YYYY-MM-DD"
export function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return dateFmt.format(d);
}

// time: "HH:MM:SS" or "HH:MM"
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

// Il turno finisce il giorno dopo? È la stessa convenzione di
// shiftDurationHours e shiftEndsAt: fine non successiva all'inizio = notturno.
export function isOvernightShift(start: string, end: string): boolean {
  return end.slice(0, 5) <= start.slice(0, 5);
}

// Intervallo orario del turno, con il giorno dopo segnalato: "22:00–04:00 +1".
// Una sede notturna non ha modo, altrimenti, di distinguere un turno di sei ore
// da uno che sembra finire diciotto ore prima di iniziare.
export function formatShiftRange(start: string, end: string): string {
  const range = `${formatTime(start)}–${formatTime(end)}`;
  return isOvernightShift(start, end) ? `${range} +1` : range;
}

// Un turno può scavalcare la mezzanotte (16:00→00:00, 22:00→04:00): l'unico
// caso senza senso è inizio uguale a fine, che varrebbe 24 ore tonde.
export function isValidShiftRange(start: string, end: string): boolean {
  return start.slice(0, 5) !== end.slice(0, 5);
}

// Un solo messaggio per l'unica regola sugli orari: i form sono cinque fra app e
// dashboard, e cinque frasi diverse per lo stesso errore sono cinque regole
// diverse agli occhi di chi le legge.
export const SHIFT_RANGE_ERROR = "Inizio e fine non possono coincidere.";

export function formatRate(rate: number | null): string {
  if (rate == null) return "Da concordare";
  return `${rate.toFixed(2).replace(".", ",")} €/h`;
}

// Durata del turno in ore (gestisce i turni che scavalcano la mezzanotte).
export function shiftDurationHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

// Istante in cui il turno finisce davvero: se l'orario di fine non è successivo
// a quello di inizio il turno scavalca la mezzanotte e finisce il giorno dopo
// (stessa convenzione di shiftDurationHours).
export function shiftEndsAt(date: string, start: string, end: string): Date {
  const d = new Date(`${date}T${end.slice(0, 5)}:00`);
  if (isOvernightShift(start, end)) d.setDate(d.getDate() + 1);
  return d;
}

/** Il minimo che serve per collocare un turno nel tempo. */
export type ShiftTimes = { date: string; start_time: string; end_time: string };

// Il turno è concluso? È questo il momento in cui si consuntivano presenze e
// ore, non la mezzanotte: un pranzo si chiude alle 15, una serata alle 2.
export function isShiftOver(
  shift: ShiftTimes,
  now: Date = new Date()
): boolean {
  return shiftEndsAt(shift.date, shift.start_time, shift.end_time) <= now;
}

// Riepilogo sotto i campi orario di un form: "Durata 4 h", oppure
// "Finisce gio 12 set alle 04:00 · 6 h" quando il turno scavalca la mezzanotte.
// Il giorno si nomina solo quando cambia: è lì che serve una conferma, ed è il
// momento in cui si intercetta un 04:00 digitato per sbaglio al posto di 16:00.
export function formatShiftSummary(
  date: string,
  start: string,
  end: string
): string {
  const hours = formatHours(shiftDurationHours(start, end));
  if (!isOvernightShift(start, end)) return `Durata ${hours}`;
  const endsOn = toDateString(shiftEndsAt(date, start, end));
  return `Finisce ${formatDate(endsOn)} alle ${formatTime(end)} · ${hours}`;
}

// Stima del compenso lordo del turno = paga oraria × durata.
export function shiftTotal(
  rate: number | null,
  start: string,
  end: string
): number | null {
  if (rate == null) return null;
  return rate * shiftDurationHours(start, end);
}

export function formatEuro(n: number): string {
  return `€${Math.round(n)}`;
}

// Ore in italiano, 1 decimale con virgola, senza decimale se intero: "5 h", "12,5 h".
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  const label =
    rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${label} h`;
}

// Scostamento con segno ("+1 h", "-0,5 h"); null quando non c'è scostamento,
// così chi lo mostra può ometterlo invece di scrivere "+0 h".
export function formatHoursVariance(hours: number): string | null {
  if (Math.abs(hours) < 0.001) return null;
  return `${hours > 0 ? "+" : ""}${formatHours(hours)}`;
}

// Tempo relativo in italiano da un timestamp ISO: "ora", "5 min fa", "2 ore fa",
// "ieri", "3 giorni fa"; oltre la settimana ricade sulla data formattata.
export function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min} min fa`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "ora" : "ore"} fa`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  return formatDate(iso.slice(0, 10));
}

// "Oggi" in ora **locale**, "YYYY-MM-DD".
//
// Sostituisce `new Date().toISOString().slice(0, 10)`, che è UTC: in Italia fra
// mezzanotte e le 01:00 (o le 02:00 con l'ora legale) restituisce *ieri* — cioè
// proprio nella finestra in cui i turni notturni sono ancora in corso, e in cui
// app e dashboard finivano per non concordare su che giorno fosse.
export function todayString(now: Date = new Date()): string {
  return toDateString(now);
}

// Chiave di ordinamento cronologico di un turno: "2026-09-12T22:00".
// Ordinare per il solo `start_time` va bene finché le righe sono tutte dello
// stesso giorno; da quando le liste "di oggi" contengono anche il turno
// notturno iniziato ieri, serve la data davanti.
export function shiftSortKey(shift: ShiftTimes): string {
  return `${shift.date}T${shift.start_time}`;
}

// Come si chiama un turno che inizia a quest'ora: "Mattina", "Pomeriggio",
// "Sera", "Notte".
//
// Serve perché il titolo di un turno non è un'ancora affidabile: da mobile i
// form lo scrivevano derivandolo dalla data (la stessa che la card mostra già
// sotto), dal web è testo libero. Una fascia derivata dall'orario dice sempre
// qualcosa, e distingue due turni dello stesso giorno — che è il caso normale.
export function shiftSlotLabel(start: string): string {
  const hour = Number(start.slice(0, 2));
  if (hour < 6) return "Notte";
  if (hour < 12) return "Mattina";
  if (hour < 17) return "Pomeriggio";
  if (hour < 22) return "Sera";
  return "Notte";
}

// Etichetta di un giorno in un'agenda: "Oggi", "Domani", "gio 12 set".
//
// I due giorni vicini si nominano invece di datarsi perché è così che se ne
// parla: chi apre l'app alle 17 vuole sapere se il turno è *stasera*, non se è
// il 12 settembre. Oltre domani la data torna a essere l'informazione utile.
export function formatDayLabel(date: string, now: Date = new Date()): string {
  const today = todayString(now);
  if (date === today) return "Oggi";
  if (date === addDaysToDate(today, 1)) return "Domani";
  return formatDate(date);
}

const monthFmt = new Intl.DateTimeFormat("it-IT", {
  month: "long",
  year: "numeric",
});

// "settembre 2026" — l'intestazione sopra il calendario.
export function formatMonthLabel(date: string): string {
  return monthFmt.format(new Date(`${date}T00:00:00`));
}

// I mesi per esteso, come li scriverebbe una persona. Scritti a mano e non presi
// da `Intl`: servono anche come **elenco da scegliere** nel campo compleanno, e
// dodici `DateTimeFormat` costruiti al volo per riempire dodici chip sono un
// costo inutile a ogni render.
export const MONTH_NAMES = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const;

// Quanti giorni ha un mese, senza anno: febbraio ne ha 29 perché il 29 febbraio
// esiste e chi ci è nato festeggia lo stesso. Stessa regola del CHECK in
// `profiles_birthday_valid`, e vanno cambiate insieme.
export function daysInMonth(month: number): number {
  if (month === 2) return 29;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// "12 marzo" — il compleanno, senza anno perché l'anno non lo salviamo
// (20260914160000). `null` quando la persona non l'ha messo.
export function formatBirthday(
  day: number | null,
  month: number | null
): string | null {
  if (!day || !month || month < 1 || month > 12) return null;
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

// Il lunedì della settimana che contiene `date`. La settimana italiana inizia di
// lunedì, mentre getDay() conta da domenica: domenica (0) appartiene alla
// settimana che è iniziata sei giorni prima, non a quella che inizia domani.
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return addDaysToDate(date, -offset);
}

const timeAtFmt = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
});

// Quanto manca all'inizio di un turno: "fra 25 min", "fra 3 ore", "domani alle
// 19:00", "gio 12 alle 19:00". È `timeAgo` al contrario, per il turno imminente
// in home: entro la giornata conta il tempo che resta, oltre conta il giorno.
export function formatRelativeStart(
  date: string,
  start: string,
  now: Date = new Date()
): string {
  const at = new Date(`${date}T${start.slice(0, 5)}:00`);
  const min = Math.round((at.getTime() - now.getTime()) / 60000);
  if (min <= 0) return "in corso";
  if (min < 60) return `fra ${min} min`;
  if (min < 24 * 60 && date === todayString(now)) {
    const hours = Math.round(min / 60);
    return `fra ${hours} ${hours === 1 ? "ora" : "ore"}`;
  }
  const time = formatTime(start);
  if (date === addDaysToDate(todayString(now), 1)) return `domani alle ${time}`;
  return `${timeAtFmt.format(at)} alle ${time}`;
}

// Date -> "YYYY-MM-DD"
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Somma (o sottrae) giorni a una data in formato colonna, "YYYY-MM-DD".
// Passa da Date per gestire fine mese e ora legale; mezzanotte locale evita lo
// scivolamento di un giorno che darebbe new Date("2026-03-29").
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

// Date -> "HH:MM"
export function toTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
