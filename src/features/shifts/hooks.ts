import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { BADGE_STALE_TIME } from "@/lib/queryClient";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { Enums, TablesInsert, TablesUpdate } from "@/types/database";
import {
  createShift,
  getOwnerPastShiftsCount,
  getOwnerPastShiftsPage,
  getOwnerShifts,
  getOwnerShiftsRange,
  getShift,
  getShiftWithVenue,
  updateShift,
  updateShiftStatus,
  type ShiftWithAssignees,
} from "./api";

/**
 * Gli hook dei turni **non prendono una sede**: leggono le sedi dell'azienda dal
 * context e le interrogano tutte insieme. È deliberato — lascia una strada sola
 * per ottenere i turni del gestore, e rende impossibile riscoprire una "sede
 * corrente" da un call site.
 *
 * Chi ha bisogno di una sede sola sta scrivendo un *form*, non una lista: usi
 * `useLastVenue()`.
 */

/** Turni non ancora conclusi, tutte le sedi. */
export function useOwnerShifts() {
  const { venueIds, venuesKey } = useOwnerVenues();
  return useQuery({
    queryKey: qk.shifts.byOwner(venuesKey),
    queryFn: () => getOwnerShifts(venueIds),
    enabled: venueIds.length > 0,
  });
}

/** Turni in un intervallo di date — vista calendario/planning. */
export function useOwnerShiftsRange(from: string, to: string) {
  const { venueIds, venuesKey } = useOwnerVenues();
  return useQuery({
    queryKey: qk.shifts.range(venuesKey, from, to),
    queryFn: () => getOwnerShiftsRange(venueIds, from, to),
    enabled: venueIds.length > 0,
  });
}

/** Storico turni — scroll infinito. */
export function useOwnerPastShifts() {
  const { venueIds, venuesKey } = useOwnerVenues();
  return useInfiniteQuery({
    queryKey: qk.shifts.past(venuesKey),
    queryFn: ({ pageParam }) => getOwnerPastShiftsPage(venueIds, pageParam),
    initialPageParam: 0,
    // `hasMore` e non `rows.length`: la pagina può essere più corta di
    // SHIFTS_PAGE_SIZE perché il turno notturno ancora in corso è stato tolto
    // dallo storico, e fermarsi lì troncherebbe la lista.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    enabled: venueIds.length > 0,
  });
}

export function useOwnerPastShiftsCount() {
  const { venueIds, venuesKey } = useOwnerVenues();
  return useQuery({
    queryKey: qk.shifts.pastCount(venuesKey),
    queryFn: () => getOwnerPastShiftsCount(venueIds),
    enabled: venueIds.length > 0,
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

/**
 * ⚠️ La mutation non sa **quale** sede: il `venue_id` viaggia nell'input, perché
 * è il turno ad avere una sede. Glielo passa il form, dove la sede è un campo.
 */
export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TablesInsert<"shifts">) => createShift(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shifts.byOwnerAll });
      qc.invalidateQueries({ queryKey: qk.shifts.rangeAny });
    },
  });
}

export function useUpdateShiftStatus(shiftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: Enums<"shift_status">) =>
      updateShiftStatus(shiftId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shifts.detail(shiftId) });
      qc.invalidateQueries({ queryKey: qk.shifts.byOwnerAll });
      qc.invalidateQueries({ queryKey: qk.shifts.rangeAny });
    },
  });
}

/**
 * Tutto ciò che la modifica di un turno può spostare. Cambiare la data non
 * tocca solo il calendario: il turno può attraversare "oggi" (storico, home,
 * copertura) e il confine del mese (riepilogo ore).
 *
 * Si invalidano i **prefissi** e non le chiavi complete: lo scope è `venuesKey`,
 * che qui non si ha a portata di mano, e in una sessione ce n'è uno solo vivo.
 */
function invalidateAfterShiftWrite(qc: QueryClient, shiftId: string) {
  qc.invalidateQueries({ queryKey: qk.shifts.detail(shiftId) });
  qc.invalidateQueries({ queryKey: qk.shifts.byOwnerAll });
  qc.invalidateQueries({ queryKey: qk.shifts.rangeAny });
  qc.invalidateQueries({ queryKey: qk.shifts.pastAll });
  qc.invalidateQueries({ queryKey: qk.shifts.pastCountAll });
  qc.invalidateQueries({ queryKey: qk.assignments.todayAll });
  // Prefisso di `qk.staff.ownerHours(ownerId, mese)`: un turno che cambia mese
  // cambia due totali nella pagina Ore.
  qc.invalidateQueries({ queryKey: qk.staff.all });
}

export function useUpdateShift(shiftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: TablesUpdate<"shifts">) => updateShift(shiftId, fields),
    onSuccess: () => invalidateAfterShiftWrite(qc, shiftId),
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
export function useMoveShiftToDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shiftId, date }: { shiftId: string; date: string }) =>
      updateShift(shiftId, { date }),

    onMutate: async ({ shiftId, date }) => {
      // Prefisso: tocca ogni intervallo in cache (il planning ne tiene più di
      // uno mentre si naviga fra settimane e mesi).
      const queryKey = qk.shifts.rangeAny;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueriesData<ShiftWithAssignees[]>({ queryKey });
      qc.setQueriesData<ShiftWithAssignees[]>({ queryKey }, (rows) =>
        rows
          ?.map((s) => (s.id === shiftId ? { ...s, date } : s))
          // La query arriva ordinata per (date, start_time, venue_id): senza
          // riordinare con **le stesse tre chiavi**, nella cella di destinazione
          // il turno finirebbe nel posto sbagliato e poi salterebbe quando
          // arriva l'echo dal server.
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              a.start_time.localeCompare(b.start_time) ||
              a.venue_id.localeCompare(b.venue_id)
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
      invalidateAfterShiftWrite(qc, shiftId),
  });
}
