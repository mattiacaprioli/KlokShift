import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { invalidateWorkViews } from "@/features/shifts/invalidation";
import { periodDays, type ReportPeriod } from "@/features/assignments/reportPeriod";
import {
  approveClockRecord,
  clockBreak,
  closeUnplannedClock,
  correctClockBreak,
  correctClockRecord,
  enterClockRecord,
  getClockBreaks,
  getMyUnplannedClock,
  getOpenUnplannedClocks,
  punchClock,
  punchUnplannedClock,
  setMemberBreakClocked,
  setMemberClockUnplanned,
  setVenueBreakClocked,
  setVenueBreakPolicy,
  setVenueClockMethod,
  setMemberClockMethod,
  voidClockRecord,
  voidUnplannedClock,
  approveRegularClockRecords,
  setVenueClockAutoApprove,
} from "./api";

// Planning e storico incorporano lo stato minimo delle timbrature per segnalare
// le anomalie: un'uscita/correzione/approvazione deve spegnere subito il badge.
function invalidateClockViews(
  qc: ReturnType<typeof useQueryClient>,
  shiftId?: string
) {
  invalidateWorkViews(qc, shiftId);
}

export function usePunchClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assignmentId: string; action: "in" | "out" }) =>
      punchClock(vars.assignmentId, vars.action),
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useClockBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { recordId: string; action: "start" | "end" }) =>
      clockBreak(vars.recordId, vars.action),
    onSuccess: () => invalidateClockViews(qc),
  });
}

/**
 * Le pause di una timbratura aperta senza turno: `get_my_unplanned_clock` dice
 * solo l'entrata. Si rileggono con `qk.clock.all`, come il resto.
 */
export function useClockBreaks(recordId: string | null | undefined) {
  return useQuery({
    queryKey: qk.clock.breaks(recordId ?? ""),
    queryFn: () => getClockBreaks(recordId as string),
    enabled: !!recordId,
  });
}

export function useApproveClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: approveClockRecord,
    onSuccess: () => invalidateClockViews(qc),
  });
}

/**
 * Approva più timbrature insieme: è il pulsante «Approva le timbrature in
 * orario». La RPC resta quella della singola riga, e qualunque sia l'esito le
 * viste si aggiornano, così un errore a metà mostra cosa è passato davvero.
 */
export function useApproveClockRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentIds: string[]) => {
      await Promise.all(assignmentIds.map((id) => approveClockRecord(id)));
    },
    onSettled: () => invalidateClockViews(qc),
  });
}

/** Orari inseriti da chi gestisce, già approvati: stesse viste da rileggere. */
export function useEnterClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: enterClockRecord,
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useCorrectClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: correctClockRecord,
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useCorrectClockBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: correctClockBreak,
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useVoidClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assignmentId: string; reason: string }) =>
      voidClockRecord(vars.assignmentId, vars.reason),
    // Anche il dettaglio del turno: per un fuori turno l'annullamento lo
    // elimina, e la schermata non deve restare sul turno in cache.
    onSuccess: (record) => invalidateClockViews(qc, record.shift_id ?? undefined),
  });
}

export function useSetVenueClockMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      venueId: string;
      method: Parameters<typeof setVenueClockMethod>[1];
    }) => setVenueClockMethod(vars.venueId, vars.method),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
      invalidateWorkViews(qc);
    },
  });
}

export function useSetVenueClockAutoApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; on: boolean }) =>
      setVenueClockAutoApprove(vars.venueId, vars.on),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.venues.mine }),
  });
}

/** Quante timbrature in orario aspettano nel periodo: il numero sul pulsante. */
export function useRegularClockCount(
  workspaceId: string | null | undefined,
  period: ReportPeriod,
  enabled = true
) {
  const { from, to } = periodDays(period);
  return useQuery({
    queryKey: qk.staff.regularClocks(workspaceId ?? "", from, to),
    queryFn: () =>
      approveRegularClockRecords({ workspaceId: workspaceId!, from, to, dryRun: true }),
    enabled: enabled && !!workspaceId,
  });
}

/** Le approva tutte, poi rilegge le viste delle ore come un'approvazione singola. */
export function useApproveRegularClockRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: string; period: ReportPeriod }) =>
      approveRegularClockRecords({ workspaceId: vars.workspaceId, ...periodDays(vars.period) }),
    onSettled: () => invalidateClockViews(qc),
  });
}

export function useSetVenueBreakPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setVenueBreakPolicy,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
      invalidateWorkViews(qc);
    },
  });
}

export function useSetMemberClockMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      venueMemberId: string;
      method: Parameters<typeof setMemberClockMethod>[1];
    }) => setMemberClockMethod(vars.venueMemberId, vars.method),
    onSuccess: () => invalidateWorkViews(qc),
  });
}

/** Dove posso timbrare senza turno: per la Home del dipendente. */
export function useMyUnplannedClock(enabled = true) {
  return useQuery({
    queryKey: qk.clock.myUnplanned,
    queryFn: getMyUnplannedClock,
    enabled,
  });
}

export function usePunchUnplannedClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: punchUnplannedClock,
    onSuccess: () => invalidateClockViews(qc),
  });
}

/**
 * Le timbrature senza turno aperte nell'azienda. Le aggiorna il realtime su
 * `shift_clock_records` (via `workViewQueryKeys`), come le altre timbrature.
 */
export function useOpenUnplannedClocks(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: qk.clock.openUnplanned(workspaceId ?? ""),
    queryFn: () => getOpenUnplannedClocks(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useCloseUnplannedClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeUnplannedClock,
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useVoidUnplannedClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: voidUnplannedClock,
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useSetVenueBreakClocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setVenueBreakClocked,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
      invalidateWorkViews(qc);
    },
  });
}

export function useSetMemberBreakClocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueMemberId: string; clocked: boolean | null }) =>
      setMemberBreakClocked(vars.venueMemberId, vars.clocked),
    onSuccess: () => invalidateWorkViews(qc),
  });
}

export function useSetMemberClockUnplanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueMemberId: string; enabled: boolean }) =>
      setMemberClockUnplanned(vars.venueMemberId, vars.enabled),
    onSuccess: () => invalidateWorkViews(qc),
  });
}
