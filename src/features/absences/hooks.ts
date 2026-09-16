import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  getAbsence,
  getAbsencesToHandle,
  getMyAbsenceEmployers,
  getMyAbsences,
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
