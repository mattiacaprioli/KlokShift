import { useMutation, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  approveClockRecord,
  correctClockRecord,
  punchClock,
  setVenueClockMethod,
  setMemberClockMethod,
  voidClockRecord,
} from "./api";

function invalidateClockViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.assignments.all });
  qc.invalidateQueries({ queryKey: qk.staff.all });
}

export function usePunchClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assignmentId: string; action: "in" | "out" }) =>
      punchClock(vars.assignmentId, vars.action),
    onSuccess: () => invalidateClockViews(qc),
  });
}

export function useApproveClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: approveClockRecord,
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

export function useVoidClockRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assignmentId: string; reason: string }) =>
      voidClockRecord(vars.assignmentId, vars.reason),
    onSuccess: () => invalidateClockViews(qc),
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
      qc.invalidateQueries({ queryKey: qk.assignments.all });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.assignments.all });
    },
  });
}
