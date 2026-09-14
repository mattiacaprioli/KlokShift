import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  getChangeRequest,
  getPendingRequestsForShift,
  requestShiftChange,
  resolveShiftChangeRequest,
  withdrawShiftChangeRequest,
} from "./api";

/**
 * Lo stato di una richiesta, letto per id.
 *
 * ⚠️ Query a sé e **non** un join dentro `getMessagesPage`: il realtime della
 * chat inserisce in cache la riga grezza di `postgres_changes`, che un embed non
 * ce l'ha mai. Con un join la card di un messaggio appena arrivato resterebbe
 * vuota finché non si ricarica il thread.
 */
export function useChangeRequest(requestId: string | null | undefined) {
  return useQuery({
    queryKey: qk.changeRequests.byId(requestId ?? ""),
    queryFn: () => getChangeRequest(requestId as string),
    enabled: !!requestId,
  });
}

/** Richieste aperte su un turno (badge nel pannello del titolare). */
export function usePendingRequestsForShift(shiftId: string, enabled = true) {
  return useQuery({
    queryKey: qk.changeRequests.byShift(shiftId),
    queryFn: () => getPendingRequestsForShift(shiftId),
    enabled: enabled && !!shiftId,
  });
}

/**
 * Le tre mutation invalidano lo stesso insieme: la richiesta cambia stato, la
 * chat riceve una riga nuova e — se è stata approvata — le assegnazioni del
 * turno sono cambiate davvero.
 */
function invalidateAfterRequestWrite(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.changeRequests.all });
  qc.invalidateQueries({ queryKey: qk.assignments.all });
  qc.invalidateQueries({ queryKey: qk.chat.all });
  qc.invalidateQueries({ queryKey: qk.shifts.all });
}

export function useRequestShiftChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assignmentId: string; reason: string }) =>
      requestShiftChange(vars.assignmentId, vars.reason),
    onSuccess: () => invalidateAfterRequestWrite(qc),
  });
}

export function useResolveShiftChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resolveShiftChangeRequest,
    onSuccess: () => invalidateAfterRequestWrite(qc),
  });
}

export function useWithdrawShiftChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => withdrawShiftChangeRequest(requestId),
    onSuccess: () => invalidateAfterRequestWrite(qc),
  });
}
