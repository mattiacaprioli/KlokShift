import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import type { Enums } from "@/types/database";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import type { ShiftWithAssignees } from "@/features/shifts/types";
import { invalidateShiftViews } from "@/features/shifts/hooks";
import type { InternalShiftPlan } from "./api";
import {
  createInternalShift,
  createInternalShifts,
  getInternalShiftPlans,
  moveAssignment,
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
  respondToAssignment,
  setAssignmentPresence,
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
    mutationFn: (vars: {
      id: string;
      status: Extract<Enums<"assignment_status">, "confirmed" | "declined">;
    }) => respondToAssignment(vars.id, vars.status),
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
 * Viste manager toccate da qualunque scrittura sui turni.
 *
 * Fino al 20/09/2026 ce n'erano **due** con questo nome, una qui e una in
 * `features/shifts/hooks.ts`, e la differenza si vedeva: dopo un trascinamento
 * nel planning le ore per persona si aggiornavano, dopo lo stesso spostamento
 * fatto dal pannello no. Ora è una sola, la più completa, e questa la richiama.
 */
function invalidateAfterShiftWrite(qc: ReturnType<typeof useQueryClient>) {
  invalidateShiftViews(qc);
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
    mutationFn: (input: Parameters<typeof createInternalShift>[0]) =>
      createInternalShift(input),
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
 * Duplica turni interni esistenti su altre date: è il "copia questa settimana su
 * quella dopo" (e il "copia questo mese sul prossimo") — un click al posto di
 * riscrivere a mano i turni che si ripetono uguali.
 *
 * `dateMap` va da data di origine a data di destinazione (`YYYY-MM-DD`), non uno
 * scostamento in giorni: su una settimana lo scostamento è sempre lo stesso, su
 * un mese no — 4 o 5 settimane a seconda della posizione nel mese, perché un
 * turno del venerdì deve ricadere di venerdì. Chi chiama decide la regola; qui si
 * applica e basta.
 *
 * ⚠️ Un piano la cui data non è nella mappa **non viene copiato**: è il 5°
 * venerdì che nel mese di destinazione non esiste. Silenzioso qui di proposito —
 * chi chiama lo conta prima e lo dice all'utente (vedi `DuplicatePeriodDialog`).
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
      /** Data di origine → data di destinazione. */
      dateMap: Record<string, string>;
      withStaff: boolean;
    }) => {
      const plans = await getInternalShiftPlans(input.sourceIds);
      return createInternalShifts(
        plans
          .filter((p) => !!input.dateMap[p.date])
          .map((p) => ({
            ...p,
            date: input.dateMap[p.date],
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
        /** `venue_members.id`: la riga di organico che riceve il turno. */
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
                  // Stessa regola del server (`reassign`): chi
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

/**
 * Sposta **una persona** da un turno a un altro: il gesto orizzontale della
 * vista per persona, «Marco giovedì invece che mercoledì», mentre i colleghi
 * di mercoledì restano dove sono.
 *
 * `to` è un turno che esiste già quel giorno, oppure una data soltanto: in quel
 * caso la RPC crea il gemello del turno di partenza. La patch ottimistica c'è
 * **solo nel primo caso** — è uno spostamento di riga fra due turni già in
 * cache — perché nel secondo il turno d'arrivo non esiste ancora, e inventarne
 * uno in cache per mezzo secondo costa più di quanto renda.
 */
export function useMoveAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      assignmentId: string;
      /** Il turno da cui parte: serve alle invalidazioni, non alla RPC. */
      fromShiftId: string;
      to: { shiftId: string } | { date: string };
    }) => moveAssignment(vars.assignmentId, vars.to),

    onMutate: async ({ assignmentId, fromShiftId, to }) => {
      if (!("shiftId" in to)) return { previous: undefined };
      const queryKey = qk.shifts.rangeAny;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueriesData<ShiftWithAssignees[]>({ queryKey });
      qc.setQueriesData<ShiftWithAssignees[]>({ queryKey }, (rows) => {
        if (!rows) return rows;
        const row = rows
          .find((s) => s.id === fromShiftId)
          ?.shift_assignments.find((a) => a.id === assignmentId);
        if (!row) return rows;
        return rows.map((s) => {
          if (s.id === fromShiftId) {
            return {
              ...s,
              shift_assignments: s.shift_assignments.filter(
                (a) => a.id !== assignmentId
              ),
            };
          }
          if (s.id !== to.shiftId) return s;
          // La riga arriva sempre `assigned`: chi si sposta non porta con sé la
          // conferma che aveva sull'altro turno. Il ruolo lo rimette a posto il
          // refetch — nella sede d'arrivo può non esistere.
          return {
            ...s,
            shift_assignments: [
              ...s.shift_assignments,
              { ...row, status: "assigned" as const },
            ],
          };
        });
      });
      return { previous };
    },

    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) {
        qc.setQueryData(key, data);
      }
    },

    onSettled: (_data, _error, { fromShiftId, to }) => {
      qc.invalidateQueries({ queryKey: qk.assignments.byShift(fromShiftId) });
      qc.invalidateQueries({ queryKey: qk.shifts.detail(fromShiftId) });
      if ("shiftId" in to) {
        qc.invalidateQueries({ queryKey: qk.assignments.byShift(to.shiftId) });
        qc.invalidateQueries({ queryKey: qk.shifts.detail(to.shiftId) });
      }
      invalidateAfterShiftWrite(qc);
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

/**
 * Statistiche aggregate di una persona dell'organico, su **tutte** le sedi
 * dell'azienda (le calcola il database). `personId` è l'id del **membro**
 * (`StaffPerson.id`), non quello di una riga di organico.
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
 * `workspaceId` delimita sia la cache sia il risultato della RPC, così il
 * cambio di azienda non può mescolare righe gestibili dallo stesso account.
 */
export function useOwnerHoursSummary(
  workspaceId: string | undefined,
  month: string
) {
  return useQuery({
    queryKey: qk.staff.ownerHours(workspaceId ?? "", month),
    queryFn: () => getOwnerHoursSummary(workspaceId as string, month),
    enabled: !!workspaceId,
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
