import { useState } from "react";
import { suggestedBreakMinutes } from "./breaks";

type BreakRule = Parameters<typeof suggestedBreakMinutes>[0];

/**
 * La pausa di un form turno. Finché nessuno la tocca segue la regola della
 * sede: cambiare orario o sede la ricalcola. Dal primo tocco è di chi compila.
 * Con `initial` (un turno esistente) parte già «toccata»: la regola non
 * riscrive mai una pausa salvata.
 */
export function useShiftBreak(
  venue: BreakRule,
  start: string,
  end: string,
  initial?: number
) {
  const [chosen, setChosen] = useState<number | null>(initial ?? null);
  return {
    minutes: chosen ?? suggestedBreakMinutes(venue, start, end),
    setMinutes: (minutes: number) => setChosen(minutes),
  };
}
