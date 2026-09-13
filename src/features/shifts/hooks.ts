import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { BADGE_STALE_TIME } from "@/lib/queryClient";
import type { Enums, TablesInsert, TablesUpdate } from "@/types/database";
import {
  createShift,
  getMyShifts,
  getShift,
  getShiftWithVenue,
  getVenuePastShiftsCount,
  getVenuePastShiftsPage,
  getOtherVenuesShiftsRange,
  getVenueShiftsRange,
  updateShift,
  updateShiftStatus,
  type ShiftWithAssignees,
} from "./api";

export function useMyShifts(venueId: string | undefined) {
  return useQuery({
    queryKey: qk.shifts.byVenue(venueId ?? ""),
    queryFn: () => getMyShifts(venueId as string),
    enabled: !!venueId,
  });
}

/**
 * I turni della settimana nelle altre sedi del titolare.
 *
 * `venueIds` vuoto ⇒ la query non parte: chi ha una sede sola non paga nulla per
 * una correttezza che non lo riguarda. `venueIds.join()` nella chiave perché
 * l'insieme delle altre sedi cambia quando si apre o si chiude un locale.
 */
export function useOtherVenuesShiftsRange(
  venueIds: string[],
  from: string,
  to: string
) {
  return useQuery({
    queryKey: qk.shifts.elsewhereRange(venueIds.join(","), from, to),
    queryFn: () => getOtherVenuesShiftsRange(venueIds, from, to),
    enabled: venueIds.length > 0,
  });
}

/** Turni del locale in un intervallo di date — vista calendario/planning. */
export function useVenueShiftsRange(
  venueId: string | undefined,
  from: string,
  to: string
) {
  return useQuery({
    queryKey: qk.shifts.range(venueId ?? "", from, to),
    queryFn: () => getVenueShiftsRange(venueId as string, from, to),
    enabled: !!venueId,
  });
}

/** Storico turni del locale — scroll infinito. */
export function useVenuePastShifts(venueId: string | undefined) {
  return useInfiniteQuery({
    queryKey: qk.shifts.past(venueId ?? ""),
    queryFn: ({ pageParam }) =>
      getVenuePastShiftsPage(venueId as string, pageParam),
    initialPageParam: 0,
    // `hasMore` e non `rows.length`: la pagina può essere più corta di
    // SHIFTS_PAGE_SIZE perché il turno notturno ancora in corso è stato tolto
    // dallo storico, e fermarsi lì troncherebbe la lista.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    enabled: !!venueId,
  });
}

export function useVenuePastShiftsCount(venueId: string | undefined) {
  return useQuery({
    queryKey: qk.shifts.pastCount(venueId ?? ""),
    queryFn: () => getVenuePastShiftsCount(venueId as string),
    enabled: !!venueId,
    staleTime: BADGE_STALE_TIME,
  });
}

export function useShift(id: string) {
  return useQuery({
    queryKey: qk.shifts.detail(id),
    queryFn: () => getShift(id),
  });
}

/** Shift detail joined with its venue (waiter detail view). */
export function useShiftWithVenue(id: string) {
  return useQuery({
    queryKey: qk.shifts.detail(id),
    queryFn: () => getShiftWithVenue(id),
  });
}

export function useCreateShift(venueId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TablesInsert<"shifts">) => createShift(input),
    onSuccess: () => {
      if (venueId) {
        qc.invalidateQueries({ queryKey: qk.shifts.byVenue(venueId) });
        qc.invalidateQueries({ queryKey: qk.shifts.rangeAll(venueId) });
      }
      // Il carico settimanale visto da un'altra sede include questo turno.
      qc.invalidateQueries({ queryKey: qk.shifts.elsewhereAll });
    },
  });
}

export function useUpdateShiftStatus(shiftId: string, venueId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: Enums<"shift_status">) =>
      updateShiftStatus(shiftId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shifts.detail(shiftId) });
      if (venueId) {
        qc.invalidateQueries({ queryKey: qk.shifts.byVenue(venueId) });
        qc.invalidateQueries({ queryKey: qk.shifts.rangeAll(venueId) });
      }
      // Un turno annullato non è carico di lavoro per nessuno, nemmeno altrove.
      qc.invalidateQueries({ queryKey: qk.shifts.elsewhereAll });
    },
  });
}

/**
 * Tutto ciò che la modifica di un turno può spostare. Cambiare la data non
 * tocca solo il calendario: il turno può attraversare "oggi" (storico, home,
 * copertura) e il confine del mese (riepilogo ore).
 */
function invalidateAfterShiftWrite(
  qc: QueryClient,
  shiftId: string,
  venueId?: string
) {
  qc.invalidateQueries({ queryKey: qk.shifts.detail(shiftId) });
  if (!venueId) return;
  qc.invalidateQueries({ queryKey: qk.shifts.byVenue(venueId) });
  qc.invalidateQueries({ queryKey: qk.shifts.rangeAll(venueId) });
  qc.invalidateQueries({ queryKey: qk.shifts.past(venueId) });
  qc.invalidateQueries({ queryKey: qk.shifts.pastCount(venueId) });
  qc.invalidateQueries({ queryKey: qk.assignments.today(venueId) });
  // Il carico settimanale di un'altra sede include questo turno: le soglie
  // 40/48h sono della persona, non del locale.
  qc.invalidateQueries({ queryKey: qk.shifts.elsewhereAll });
  // Prefisso di `qk.staff.ownerHours(ownerId, mese)`: un turno che cambia mese
  // cambia due totali nella pagina Ore. Il prefisso largo serve anche perché le
  // ore sono dell'**azienda** (20260913110100): un turno spostato da una sede
  // all'altra non cambia il totale di nessuno, ma cambia il suo dettaglio.
  qc.invalidateQueries({ queryKey: qk.staff.all });
}

export function useUpdateShift(shiftId: string, venueId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: TablesUpdate<"shifts">) => updateShift(shiftId, fields),
    onSuccess: () => invalidateAfterShiftWrite(qc, shiftId, venueId),
  });
}

/**
 * Sposta un turno di giorno. L'id sta nelle **variabili**, non legato alla
 * chiamata dell'hook come in `useUpdateShift`: in una griglia il turno lo
 * sceglie il gesto, e un hook per card non è un'opzione.
 *
 * ⚠️ È l'unico `onMutate` del repo: la convenzione (`chat/hooks.ts`) è scrivere
 * in cache in `onSuccess`. Qui non basta — senza scrittura ottimistica la card
 * resterebbe nel giorno di partenza per tutto il round-trip, e il trascinamento
 * sembrerebbe non aver funzionato. L'echo realtime (`RealtimeSync`) invalida
 * subito dopo: il valore ottimistico coincide con quello del server, quindi non
 * sfarfalla. Se invece la scrittura fallisce l'echo non arriva, e il rollback
 * qui sotto è l'ultima parola.
 */
export function useMoveShiftToDate(venueId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shiftId, date }: { shiftId: string; date: string }) =>
      updateShift(shiftId, { date }),

    onMutate: async ({ shiftId, date }) => {
      if (!venueId) return;
      // Prefisso: tocca ogni intervallo in cache (il planning ne tiene più di
      // uno mentre si naviga fra settimane e mesi).
      const queryKey = qk.shifts.rangeAll(venueId);
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueriesData<ShiftWithAssignees[]>({ queryKey });
      qc.setQueriesData<ShiftWithAssignees[]>({ queryKey }, (rows) =>
        rows
          ?.map((s) => (s.id === shiftId ? { ...s, date } : s))
          // La query arriva ordinata per (date, start_time): senza riordinare,
          // nella cella di destinazione il turno finirebbe nel posto sbagliato.
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              a.start_time.localeCompare(b.start_time)
          )
      );
      return { previous };
    },

    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        qc.setQueryData(key, data);
      }
    },

    onSettled: (_data, _error, { shiftId }) =>
      invalidateAfterShiftWrite(qc, shiftId, venueId),
  });
}
