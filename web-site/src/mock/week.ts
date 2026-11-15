/*
 * La settimana finta del sito vetrina: una sola fonte per l'apertura, la storia
 * e la chiusura, così le tre viste raccontano la stessa settimana.
 *
 * Un'azienda qualunque a turni, non un ristorante: reception, magazzino, cassa,
 * sala, pulizie (vedi la regola sugli esempi in AGENTS.md). Sono dati di un
 * mockup, non copy: non finiscono mai in un testo da leggere.
 */

export type ShiftState = "draft" | "pending" | "confirmed" | "open";

export type WeekShift = {
  /** Indice in `WEEK_PEOPLE`; `-1` è la riga «Da coprire». */
  person: number;
  /** 0 = lunedì … 6 = domenica. */
  day: number;
  time: string;
  role: string;
  state: ShiftState;
};

export const WEEK_DAYS: readonly string[] = [
  "Lun 16",
  "Mar 17",
  "Mer 18",
  "Gio 19",
  "Ven 20",
  "Sab 21",
  "Dom 22",
];

export const WEEK_PEOPLE: readonly { name: string; initials: string; tone: string }[] = [
  { name: "Giulia R.", initials: "GR", tone: "bg-gold" },
  { name: "Marco T.", initials: "MT", tone: "bg-[#9ec7a8]" },
  { name: "Sara P.", initials: "SP", tone: "bg-[#c9a7e0]" },
  { name: "Luca F.", initials: "LF", tone: "bg-[#e9a194]" },
  { name: "Anna B.", initials: "AB", tone: "bg-[#8fb6e8]" },
];

/** Chi copre il buco del sabato quando la settimana è tutta confermata. */
const COVERS_OPEN_SHIFT = 3;

const s = (
  person: number,
  day: number,
  time: string,
  role: string,
  state: ShiftState = "confirmed"
): WeekShift => ({ person, day, time, role, state });

export const WEEK_SHIFTS: readonly WeekShift[] = [
  s(0, 0, "7–15", "Reception"),
  s(0, 1, "7–15", "Reception"),
  s(0, 3, "15–23", "Reception"),
  s(0, 4, "15–23", "Reception"),
  s(0, 6, "7–15", "Reception"),
  s(1, 1, "9–17", "Magazzino"),
  s(1, 2, "9–17", "Magazzino"),
  s(1, 3, "9–17", "Magazzino"),
  s(1, 5, "8–14", "Inventario"),
  s(2, 0, "10–19", "Cassa"),
  s(2, 2, "10–19", "Cassa"),
  s(2, 4, "10–19", "Cassa", "pending"),
  s(2, 5, "10–19", "Cassa"),
  s(3, 2, "18–24", "Sala"),
  s(3, 3, "18–24", "Sala"),
  s(3, 4, "18–24", "Sala"),
  s(3, 6, "12–18", "Sala"),
  s(4, 0, "6–12", "Pulizie"),
  s(4, 1, "6–12", "Pulizie"),
  s(4, 3, "6–12", "Pulizie"),
  s(4, 6, "6–12", "Pulizie"),
  s(-1, 5, "18–24", "Sala", "open"),
];

/** La stessa settimana prima di essere pubblicata. */
export function draftWeek(shifts: readonly WeekShift[]): WeekShift[] {
  return shifts.map((shift) => ({ ...shift, state: "draft" }));
}

/** La settimana a fine storia: tutti hanno confermato, il buco è coperto. */
export function confirmedWeek(shifts: readonly WeekShift[]): WeekShift[] {
  return shifts.map((shift) => ({
    ...shift,
    person: shift.state === "open" ? COVERS_OPEN_SHIFT : shift.person,
    state: "confirmed",
  }));
}
