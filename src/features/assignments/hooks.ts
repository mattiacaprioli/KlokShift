import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import type { Enums } from "@/types/database";
import { addDaysToDate } from "@/lib/format";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { ShiftWithAssignees } from "@/features/shifts/types";
import type {
  InternalShiftPlan,
  RoleTargetInput,
  StaffAssignmentInput,
} from "./api";
import {
  createInternalShift,
  createInternalShifts,
  getInternalShiftPlans,
  getMyAssignedUpcoming,
  getMyAssignmentForShift,
  getShiftAssignments,
  getShiftRoleRequirements,
  STAFF_RECENT_SHIFTS,
  getPersonPerformance,
  getPersonWorkedShifts,
  getOwnerTodayAssignments,
  getOwnerHoursSummary,
  reassignShiftAssignment,
  setAssignmentPresence,
  updateAssignmentStatus,
  updateInternalShift,
} from "./api";

export function useMyAssignedUpcoming(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.assignments.mineUpcoming(waiterId ?? ""),
    queryFn: () => getMyAssignedUpcoming(waiterId as string),
    enabled: !!waiterId,
  });
}

export function useMyAssignmentForShift(
  shiftId: string,
  waiterId: string | undefined
) {
  return useQuery({
    queryKey: qk.assignments.mineForShift(shiftId, waiterId ?? ""),
    queryFn: () => getMyAssignmentForShift(shiftId, waiterId as string),
    enabled: !!waiterId,
  });
}

/** Waiter confirms/declines an assignment; refresh every assignment view. */
export function useRespondToAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: Enums<"assignment_status"> }) =>
      updateAssignmentStatus(vars.id, vars.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.assignments.all }),
  });
}

/** `enabled`: ha senso solo sui turni interni (vedi `useApplications`). */
export function useShiftAssignments(shiftId: string, enabled = true) {
  return useQuery({
    queryKey: qk.assignments.byShift(shiftId),
    queryFn: () => getShiftAssignments(shiftId),
    enabled,
  });
}

/** Chi lavora oggi, in tutte le sedi dell'azienda. */
export function useOwnerTodayAssignments() {
  const { venueIds, venuesKey } = useOwnerVenues();
  return useQuery({
    queryKey: qk.assignments.today(venuesKey),
    queryFn: () => getOwnerTodayAssignments(venueIds),
    enabled: venueIds.length > 0,
  });
}

/**
 * Viste manager toccate da qualunque creazione di turni interni.
 *
 * Prefissi e non chiavi complete: lo scope è `venuesKey`, che qui non si ha, e
 * in una sessione ce n'è uno solo vivo.
 */
function invalidateAfterShiftWrite(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.shifts.byOwnerAll });
  qc.invalidateQueries({ queryKey: qk.shifts.rangeAny });
  qc.invalidateQueries({ queryKey: qk.assignments.all });
}

/**
 * Crea un turno interno + le assegnazioni, poi aggiorna le viste del gestore.
 *
 * ⚠️ `venue_id` sta **nell'input**, non nell'hook: è il turno ad avere una sede,
 * e gliela passa il form, dove la sede è il primo campo.
 */
export function useCreateInternalShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      venue_id: string;
      title: string;
      date: string;
      start_time: string;
      end_time: string;
      description: string | null;
      staff: StaffAssignmentInput[];
      roleTargets?: RoleTargetInput[];
    }) => createInternalShift(input),
    onSuccess: () => invalidateAfterShiftWrite(qc),
  });
}

/**
 * Crea **più** turni interni in una volta (es. lo stesso turno su lun-mar-ven).
 * Stesse invalidazioni della creazione singola. Ogni piano porta la sua sede.
 */
export function useCreateInternalShifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plans: InternalShiftPlan[]) => createInternalShifts(plans),
    onSuccess: () => invalidateAfterShiftWrite(qc),
  });
}

/**
 * Duplica turni interni esistenti spostandoli di `dayShift` giorni: è il
 * "copia questa settimana su quella dopo" — un click al posto di riscrivere a
 * mano i turni che si ripetono uguali ogni settimana.
 *
 * `withStaff: false` copia la griglia (orari e fabbisogno per ruolo) lasciando
 * i turni da assegnare: utile quando le persone cambiano ma la struttura no, e
 * soprattutto **non manda notifiche a nessuno**.
 *
 * ⚠️ Ogni copia resta **nella sede del turno che l'ha generata** (`p.venue_id`
 * arriva dal piano). La settimana duplicata può contenere Roma e Milano: un
 * `venue_id` unico le spingerebbe tutte in una sede sola, in silenzio.
 */
export function useCopyInternalShifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceIds: string[];
      dayShift: number;
      withStaff: boolean;
    }) => {
      const plans = await getInternalShiftPlans(input.sourceIds);
      return createInternalShifts(
        plans.map((p) => ({
          ...p,
          date: addDaysToDate(p.date, input.dayShift),
          staff: input.withStaff ? p.staff : [],
        }))
      );
    },
    onSuccess: () => invalidateAfterShiftWrite(qc),
  });
}

/** Modifica completa di un turno interno; aggiorna tutte le viste manager. */
export function useUpdateInternalShift(shiftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateInternalShift>[1]) =>
      updateInternalShift(shiftId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shifts.all });
      qc.invalidateQueries({ queryKey: qk.assignments.all });
    },
  });
}

/**
 * Riassegna un turno a un'altra persona (trascinamento nella vista per persona
 * del planning). La patch ottimistica scrive `status: "assigned"` perché è così
 * che nascerà la riga vera: chi entra non ha confermato niente.
 *
 * Nota: scambiare un Cameriere con un Barista può far passare la copertura da
 * verde ad arancione. È corretto — `shiftCoverage()` guarda i ruoli — e si vede
 * subito, che è il punto.
 */
export function useReassignShiftAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      assignmentId: string;
      shiftId: string;
      toStaffMember: {
        id: string;
        /** La persona dietro l'appartenenza: serve al carico settimanale. */
        person_id: string;
        display_name: string;
        /** Le sue mansioni: servono a indovinare il ruolo come fa il server. */
        roles: { id: string; name: string }[];
      };
    }) => reassignShiftAssignment(vars.assignmentId, vars.toStaffMember.id),

    onMutate: async ({ assignmentId, shiftId, toStaffMember }) => {
      const queryKey = qk.shifts.rangeAny;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueriesData<ShiftWithAssignees[]>({ queryKey });
      qc.setQueriesData<ShiftWithAssignees[]>({ queryKey }, (rows) =>
        rows?.map((s) =>
          s.id !== shiftId
            ? s
            : {
                ...s,
                shift_assignments: s.shift_assignments.map((a) => {
                  if (a.id !== assignmentId) return a;
                  // Stessa regola del server (`reassign_shift_assignment`): chi
                  // entra tiene il ruolo di chi esce se lo sa fare, altrimenti
                  // prende il suo unico ruolo, altrimenti resta da scegliere.
                  // Ricopiarla qui evita che la copertura sfarfalli fra il
                  // trascinamento e il refetch.
                  const kept = toStaffMember.roles.find(
                    (r) => r.id === a.role_id
                  );
                  const role =
                    kept ??
                    (toStaffMember.roles.length === 1
                      ? toStaffMember.roles[0]
                      : null);
                  return {
                    ...a,
                    status: "assigned" as const,
                    role_id: role?.id ?? null,
                    role,
                    staff_member: {
                      id: toStaffMember.id,
                      person_id: toStaffMember.person_id,
                      display_name: toStaffMember.display_name,
                      // Lo rimette a posto il refetch: qui serve solo al
                      // conteggio dei destinatari, che non è ancora in gioco.
                      waiter_id: null,
                    },
                  };
                }),
              }
        )
      );
      return { previous };
    },

    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        qc.setQueryData(key, data);
      }
    },

    onSettled: (_data, _error, { shiftId }) => {
      qc.invalidateQueries({ queryKey: qk.assignments.byShift(shiftId) });
      qc.invalidateQueries({ queryKey: qk.shifts.detail(shiftId) });
      invalidateAfterShiftWrite(qc);
      // Le statistiche per persona cambiano da entrambi i lati.
      qc.invalidateQueries({ queryKey: qk.staff.all });
    },
  });
}

/** `enabled`: ha senso solo sui turni interni (vedi `useApplications`). */
export function useShiftRoleRequirements(shiftId: string, enabled = true) {
  return useQuery({
    queryKey: qk.assignments.roleReqs(shiftId),
    queryFn: () => getShiftRoleRequirements(shiftId),
    enabled,
  });
}

export function useUpdateAssignmentStatus(shiftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: Enums<"assignment_status"> }) =>
      updateAssignmentStatus(vars.id, vars.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.assignments.byShift(shiftId) });
      qc.invalidateQueries({ queryKey: qk.assignments.all });
    },
  });
}

/**
 * Statistiche aggregate di una persona dell'organico, su **tutte** le sedi del
 * titolare (le calcola il database).
 */
export function usePersonPerformance(personId: string | undefined) {
  return useQuery({
    queryKey: qk.assignments.personPerformance(personId ?? ""),
    queryFn: () => getPersonPerformance(personId as string),
    enabled: !!personId,
  });
}

/** Ultimi turni svolti dalla persona, con la sede, ordinati dal database. */
export function usePersonWorkedShifts(
  personId: string | undefined,
  limit = STAFF_RECENT_SHIFTS
) {
  return useQuery({
    queryKey: qk.assignments.personWorked(personId ?? "", limit),
    queryFn: () => getPersonWorkedShifts(personId as string, limit),
    enabled: !!personId,
  });
}

/**
 * Le ore di tutta l'azienda in un mese.
 *
 * ⚠️ `ownerId` è **solo la chiave di cache**: la RPC non lo riceve, usa
 * `auth.uid()`. Serve a non mescolare la cache di due account sullo stesso
 * dispositivo, e a spegnere la query per chi non è un titolare.
 */
export function useOwnerHoursSummary(
  ownerId: string | undefined,
  month: string
) {
  return useQuery({
    queryKey: qk.staff.ownerHours(ownerId ?? "", month),
    queryFn: () => getOwnerHoursSummary(month),
    enabled: !!ownerId,
  });
}

/** Manager marks presence/hours on a concluded internal shift; refresh views. */
export function useSetAssignmentPresence(shiftId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...fields
    }: {
      id: string;
      status?: Enums<"assignment_status">;
      worked_hours?: number | null;
    }) => setAssignmentPresence(id, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.assignments.byShift(shiftId) });
      qc.invalidateQueries({ queryKey: qk.assignments.all });
      qc.invalidateQueries({ queryKey: qk.staff.all });
    },
  });
}
