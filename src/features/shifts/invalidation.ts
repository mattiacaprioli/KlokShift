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
    qk.absences.summaryAll,
    qk.absences.creditsAll,
  ];
}

export function invalidateShiftViews(qc: QueryClient, shiftId?: string) {
  for (const queryKey of shiftViewQueryKeys(shiftId)) {
    qc.invalidateQueries({ queryKey });
  }
}

/**
 * Prefissi toccati quando cambia il **lavorato** di un'assegnazione: presenza,
 * ore rettificate, timbratura (entrata, uscita, correzione, approvazione,
 * annullamento), metodo di rilevazione. Locale o realtime, la lista è questa.
 *
 * Accanto alle ore ci sono **sempre** i crediti di assenza: il server decide il
 * conflitto fra lavoro e assenza riconosciuta, e un consuntivo che rilegge le ore
 * nuove ma tiene i crediti in cache le sommerebbe tutte e due.
 *
 * `assignments.all` e non solo `byShift`: sotto lo stesso prefisso vivono le
 * ore e il rendimento della persona (`personWorked`, `personPerformance`), che
 * un evento non sa indirizzare perché porta il membro di sede, non la persona.
 */
export function workViewQueryKeys(
  shiftId?: string
): readonly (readonly unknown[])[] {
  return [
    ...(shiftId ? [qk.shifts.detail(shiftId)] : []),
    qk.assignments.all,
    qk.shifts.byOwnerAll,
    qk.shifts.rangeAny,
    qk.shifts.pastAll,
    qk.staff.all,
    qk.absences.summaryAll,
    qk.absences.creditsAll,
  ];
}

/**
 * Le chiavi di un evento realtime su `shift_assignments` o `shift_clock_records`.
 * Su DELETE la riga porta solo l'id: senza `shift_id` resta la lista larga.
 */
export function workEventQueryKeys(
  row: Record<string, unknown>
): readonly (readonly unknown[])[] {
  const shiftId = typeof row.shift_id === "string" ? row.shift_id : undefined;
  return workViewQueryKeys(shiftId);
}

export function invalidateWorkViews(qc: QueryClient, shiftId?: string) {
  for (const queryKey of workViewQueryKeys(shiftId)) {
    qc.invalidateQueries({ queryKey });
  }
}
