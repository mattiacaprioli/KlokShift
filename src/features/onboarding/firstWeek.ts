import type { FirstStep } from "./firstSteps";

/**
 * La prima settimana di un'azienda senza turni: quale si apre e cosa propone.
 *
 * Il 15/11/2026, una domenica, chi era appena entrato trovava la settimana in
 * corso con sei giorni passati su sette e il «+ Già fatto» su ciascuno: il primo
 * gesto proposto era registrare turni nel passato. Come Planday e When I Work,
 * la prima settimana è quella da preparare, e dentro c'è il passo che manca.
 */

/** Il lunedì da aprire (YYYY-MM-DD): sabato e domenica, la prossima settimana. */
export function firstWeekStart(today: string): string {
  const d = new Date(`${today}T00:00:00`);
  const weekday = (d.getDay() + 6) % 7; // 0 = lunedì … 6 = domenica
  d.setDate(d.getDate() - weekday + (weekday >= 5 ? 7 : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type EmptyWeekGuide = "roles" | "people" | "shift";

/**
 * Cosa propone la settimana vuota, dai «Primi passi»: i ruoli, poi le persone,
 * poi il primo turno. Niente se c'è già un turno o se la prova non è avviata
 * (lì parla già l'avviso della prova).
 */
export function emptyWeekGuide(steps: readonly FirstStep[]): EmptyWeekGuide | null {
  const status = (id: FirstStep["id"]) => steps.find((s) => s.id === id)?.status;
  if (status("trial") !== "done" || status("shift") !== "todo") return null;
  if (status("roles") === "todo") return "roles";
  if (status("people") === "todo") return "people";
  return "shift";
}
