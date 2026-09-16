import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { absenceConflicts, type AbsenceWindow } from "./conflicts";
import {
  getAbsence,
  getAbsenceAvailability,
  getPersonShiftsInRange,
  removeFromShifts,
  getAbsencesToHandle,
  getMyAbsenceEmployers,
  getMyAbsences,
  getOwnerAbsenceSummary,
  getPersonAbsences,
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
  return useQuery({
    queryKey: qk.absences.mine(waiterId ?? ""),
    queryFn: () => getMyAbsences(waiterId as string),
    enabled: !!waiterId,
  });
}

export function useMyAbsenceEmployers(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.absences.employers(waiterId ?? ""),
    queryFn: () => getMyAbsenceEmployers(waiterId as string),
    enabled: !!waiterId,
  });
}

export function usePersonAbsences(personId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.absences.byPerson(personId ?? ""),
    queryFn: () => getPersonAbsences(personId as string),
    enabled: enabled && !!personId,
  });
}

export function useAbsencesToHandle(enabled = true) {
  return useQuery({
    queryKey: qk.absences.toHandle,
    queryFn: getAbsencesToHandle,
    enabled,
  });
}

/**
 * Ogni scrittura cambia lo stato dell'assenza (tutte le liste sotto
 * `absences.all`) e, tranne `record` e il protocollo, aggiunge una card al
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
  absence: (AbsenceWindow & { person_id: string }) | null,
  enabled = true
) {
  const on = enabled && !!absence;
  const query = useQuery({
    queryKey: qk.assignments.personRange(
      absence?.person_id ?? "",
      absence?.start_date ?? "",
      absence?.end_date ?? ""
    ),
    queryFn: () =>
      getPersonShiftsInRange(
        absence!.person_id,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.assignments.all });
      qc.invalidateQueries({ queryKey: qk.shifts.all });
      qc.invalidateQueries({ queryKey: qk.planning.all });
    },
  });
}

/**
 * Il riepilogo assenze del mese. Come `useOwnerHoursSummary`, `ownerId` è solo
 * la chiave di cache: la RPC usa `auth.uid()`.
 */
export function useOwnerAbsenceSummary(
  ownerId: string | undefined,
  month: string
) {
  return useQuery({
    queryKey: qk.absences.summary(ownerId ?? "", month),
    queryFn: () => getOwnerAbsenceSummary(month),
    enabled: !!ownerId,
  });
}
