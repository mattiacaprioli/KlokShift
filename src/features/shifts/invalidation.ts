import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";

/**
 * Prefissi toccati da una modifica alla riga del turno, locale o realtime.
 * Un turno può attraversare oggi (storico, home, copertura) e il confine del
 * mese. Include quindi `staff.all`: sotto quel prefisso vivono i riepiloghi ore
 * di tutti i mesi, così uno spostamento invalida origine e destinazione.
 *
 * Questa è l'unica lista: hook turni, hook assegnazioni e RealtimeSync la
 * condividono per non aggiornare viste diverse a seconda del percorso usato.
 */
export function shiftViewQueryKeys(
  shiftId?: string
): readonly (readonly unknown[])[] {
  return [
    ...(shiftId ? [qk.shifts.detail(shiftId)] : []),
    qk.shifts.byOwnerAll,
    qk.shifts.rangeAny,
    qk.shifts.pastAll,
    qk.shifts.pastCountAll,
    qk.assignments.todayAll,
    qk.staff.all,
  ];
}

export function invalidateShiftViews(qc: QueryClient, shiftId?: string) {
  for (const queryKey of shiftViewQueryKeys(shiftId)) {
    qc.invalidateQueries({ queryKey });
  }
}
