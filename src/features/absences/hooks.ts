import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { absenceConflicts, type AbsenceWindow } from "./conflicts";
import { invalidateAfterShiftRemoval } from "./removal";
import {
  getAbsence,
  getAbsenceAvailability,
  getPersonShiftsInRange,
  removeFromShifts,
  getAbsencesToHandle,
  getCompanyAbsences,
  absenceEmployersOf,
  ABSENCES_PAGE_SIZE,
  getMyAbsencesPage,
  getMyCurrentAbsences,
  getOwnerAbsenceSummary,
  getPersonAbsencesPage,
  recordAbsence,
  requestAbsence,
  resolveAbsence,
  setAbsenceInpsProtocol,
  withdrawAbsence,
} from "./api";

/**
 * L'assenza letta per id, per la card nel thread.
 *
 * ⚠️ Query a sé e non un join sui messaggi, per la stessa ragione di
 * `useChangeRequest`: il realtime della chat mette in cache la riga grezza.
 */
export function useAbsence(absenceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.absences.byId(absenceId ?? ""),
    queryFn: () => getAbsence(absenceId as string),
    enabled: !!absenceId,
  });
}

export function useMyAbsences(waiterId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: qk.absences.mine(waiterId ?? ""),
    queryFn: ({ pageParam }) =>
      getMyAbsencesPage(waiterId as string, pageParam),
    initialPageParam: null as import("./api").AbsenceCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < ABSENCES_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { start_date: last.start_date, id: last.id };
    },
    enabled: !!waiterId,
  });
  return { ...query, data: query.data?.pages.flat() };
}

/** Solo le assenze che possono ancora sovrapporsi ai turni in agenda. */
export function useMyCurrentAbsences(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.absences.current(waiterId ?? ""),
    queryFn: () => getMyCurrentAbsences(waiterId as string),
    enabled: !!waiterId,
  });
}

/**
 * Le aziende a cui chiedere un'assenza: nessuna query, si ricavano dalle
 * appartenenze (`get_my_context`). Stessi nomi di `UseQueryResult`.
 */
export function useMyAbsenceEmployers() {
  const { memberships, isLoading, isError, refetch } = useOwnerVenues();
  const data = useMemo(() => absenceEmployersOf(memberships), [memberships]);
  return { data, isLoading, isError, refetch };
}

export function usePersonAbsences(memberId: string | undefined, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: qk.absences.byPerson(memberId ?? ""),
    queryFn: ({ pageParam }) =>
      getPersonAbsencesPage(memberId as string, pageParam),
    initialPageParam: null as import("./api").AbsenceCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < ABSENCES_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { start_date: last.start_date, id: last.id };
    },
    enabled: enabled && !!memberId,
  });
  return { ...query, data: query.data?.pages.flat() };
}

export function useAbsencesToHandle(enabled = true) {
  const { workspaceId } = useOwnerVenues();
  return useQuery({
    queryKey: qk.absences.toHandle(workspaceId ?? ""),
    queryFn: () => getAbsencesToHandle(workspaceId as string),
    enabled: enabled && !!workspaceId,
  });
}

/**
 * Quante richieste aspettano una risposta: il badge della tab Staff e della
 * voce Assenze. Stessa query del blocco «Richieste» della home, quindi nessuna
 * richiesta in più; `select` conta senza toccare la cache.
 */
export function usePendingAbsenceCount(enabled = true): number {
  const { workspaceId } = useOwnerVenues();
  const query = useQuery({
    queryKey: qk.absences.toHandle(workspaceId ?? ""),
    queryFn: () => getAbsencesToHandle(workspaceId as string),
    enabled: enabled && !!workspaceId,
    select: (rows) => rows.filter((a) => a.status === "pending").length,
  });
  return enabled ? (query.data ?? 0) : 0;
}

export function useCompanyAbsences(enabled = true) {
  const { workspaceId } = useOwnerVenues();
  return useQuery({
    queryKey: qk.absences.company(workspaceId ?? ""),
    queryFn: () => getCompanyAbsences(workspaceId as string),
    enabled: enabled && !!workspaceId,
  });
}

/**
 * Ogni scrittura cambia lo stato dell'assenza (tutte le liste sotto
 * `absences.all`) e, tranne `record` e il riferimento del certificato, aggiunge una card al
 * thread.
 */
function invalidateAfterAbsenceWrite(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.absences.all });
  qc.invalidateQueries({ queryKey: qk.chat.all });
}

export function useRequestAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: requestAbsence,
    onSuccess: () => invalidateAfterAbsenceWrite(qc),
  });
}

export function useRecordAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordAbsence,
    onSuccess: () => invalidateAfterAbsenceWrite(qc),
  });
}

export function useResolveAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resolveAbsence,
    onSuccess: () => invalidateAfterAbsenceWrite(qc),
  });
}

export function useWithdrawAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (absenceId: string) => withdrawAbsence(absenceId),
    onSuccess: () => invalidateAfterAbsenceWrite(qc),
  });
}

export function useSetAbsenceInpsProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setAbsenceInpsProtocol,
    onSuccess: () => invalidateAfterAbsenceWrite(qc),
  });
}

/** Chi non c'è fra due date, per il planning (senza il tipo di assenza). */
export function useAbsenceAvailability(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: qk.absences.availability(from, to),
    queryFn: () => getAbsenceAvailability(from, to),
    enabled: enabled && !!from && !!to,
  });
}

/**
 * I turni della persona che cadono nell'assenza e non sono ancora finiti.
 * `enabled` va spento sulle assenze chiuse: non hanno niente da togliere.
 */
export function useAbsenceConflicts(
  absence: (AbsenceWindow & { member_id: string }) | null,
  enabled = true
) {
  const on = enabled && !!absence;
  const query = useQuery({
    queryKey: qk.assignments.personRange(
      absence?.member_id ?? "",
      absence?.start_date ?? "",
      absence?.end_date ?? ""
    ),
    queryFn: () =>
      getPersonShiftsInRange(
        absence!.member_id,
        absence!.start_date,
        absence!.end_date
      ),
    enabled: on,
  });
  const conflicts = useMemo(
    () =>
      absence && query.data
        ? absenceConflicts(
            query.data.map((a) => ({ ...a.shift, assignmentId: a.id })),
            absence
          )
        : [],
    [absence, query.data]
  );
  return { ...query, conflicts };
}

export function useRemoveFromShifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeFromShifts,
    // Anche un errore può arrivare dopo una o più rimozioni già committate, o
    // dopo il commit della richiesta corrente: la cache si rilegge sempre. La
    // Promise mantiene il bottone disabilitato finché il refetch attivo finisce.
    onSettled: () => invalidateAfterShiftRemoval(qc),
  });
}

/**
 * Il riepilogo assenze del mese, confinato all'azienda sia nella cache sia
 * nella RPC.
 */
export function useOwnerAbsenceSummary(
  workspaceId: string | undefined,
  month: string
) {
  return useQuery({
    queryKey: qk.absences.summary(workspaceId ?? "", month),
    queryFn: () => getOwnerAbsenceSummary(workspaceId as string, month),
    enabled: !!workspaceId,
  });
}
