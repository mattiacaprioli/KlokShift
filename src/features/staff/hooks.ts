import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { getMyContext } from "@/features/workspace/api";
import type { Membership } from "@/features/workspace/types";
import {
  addPersonToVenue,
  addSelfToStaff,
  addStaff,
  getMyEmployers,
  getOwnerPeople,
  getStaffPerson,
  getVenueStaff,
  leaveVenue,
  removeStaffMember,
  sendStaffInvite,
  updateStaffMember,
  updateStaffPerson,
  type StaffPersonPatch,
} from "./api";

/** Waiter: le sedi in cui è in organico ("Le tue sedi"). */
export function useMyEmployers(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.employers(waiterId ?? ""),
    queryFn: () => getMyEmployers(waiterId as string),
    enabled: !!waiterId,
  });
}

/**
 * Gestione: tutte le sue persone, con le sedi in cui lavorano.
 *
 * Serve dove il perimetro è l'**azienda** e non la sede: aggiungere a Milano chi
 * si ha già a Roma, e scegliere un destinatario in chat (il thread è per persona).
 */
export function useOwnerPeople(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.people(workspaceId ?? ""),
    queryFn: () => getOwnerPeople(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useVenueStaff(venueId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.byVenue(venueId ?? ""),
    queryFn: () => getVenueStaff(venueId as string),
    enabled: !!venueId,
  });
}

/** La scheda di un dipendente: la persona con tutte le sue sedi. */
export function useStaffPerson(personId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.person(personId ?? ""),
    queryFn: () => getStaffPerson(personId as string),
    enabled: !!personId,
  });
}

/**
 * L'aggiunta dal form: decide da sola (`add_member`) tra scheda, invito in-app
 * ed email. È quella che usano le schermate di creazione.
 */
export function useAddStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addStaff,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

/**
 * Chi gestisce si mette da sé in organico. Vedi `addSelfToStaff`.
 *
 * Invalida anche i turni e il contesto: da adesso quella persona compare nel
 * picker «Chi chiami» e nelle griglie del planning, e nelle sue `works`.
 */
export function useAddSelfToStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addSelfToStaff,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.shifts.all });
      qc.invalidateQueries({ queryKey: qk.context.mine });
    },
  });
}

/** Reinvia l'email d'invito dalla scheda della persona (o del collaboratore). */
export function useSendStaffInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => sendStaffInvite(memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.team.all });
    },
  });
}

/** Una persona che l'azienda ha già, aggiunta (o rimessa) in una sua sede. */
export function useAddPersonToVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof addPersonToVenue>[0]) =>
      addPersonToVenue(vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.context.mine });
    },
  });
}

/**
 * L'anagrafica: nome, telefono, note, contratto. Invalida tutto `staff.all` e
 * non solo la sede corrente, perché la persona può lavorare in più sedi.
 */
export function useUpdateStaffPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; fields: StaffPersonPatch }) =>
      updateStaffPerson(vars.id, vars.fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

/** Quel che è della singola sede: tipo di impiego e mansioni, in una scrittura. */
export function useUpdateStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof updateStaffMember>[0]) =>
      updateStaffMember(vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.roles.all });
    },
  });
}

/** Toglie la persona da una sede (`venueId`) o da tutta l'azienda. */
export function useRemoveStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { memberId: string; venueId?: string }) =>
      removeStaffMember(vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.context.mine });
      // L'uscita libera i turni futuri e il trigger aggiorna i coperti: senza
      // realtime resterebbero stali.
      qc.invalidateQueries({ queryKey: qk.assignments.all });
      qc.invalidateQueries({ queryKey: qk.shifts.all });
    },
  });
}

function invitedMemberships(memberships: Membership[]): Membership[] {
  return memberships.filter((m) => m.status === "invited");
}

/**
 * Waiter: i suoi inviti da accettare (le appartenenze `invited` del contesto).
 * Stessa query e stessa chiave di `useMyContext`: non costa una richiesta in più.
 */
export function useMyPendingInvites(userId: string | undefined) {
  return useQuery({
    queryKey: qk.context.mine,
    queryFn: getMyContext,
    enabled: !!userId,
    select: (ctx) => invitedMemberships(ctx.memberships),
  });
}

/** Waiter: lascia una sede (`venueMemberId` = riga di organico), poi rinfresca. */
export function useLeaveVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (venueMemberId: string) => leaveVenue(venueMemberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.context.mine });
      // I turni futuri di quella sede sono stati tolti: l'agenda del
      // professionista li mostrerebbe ancora, e il trigger dei coperti ha
      // aggiornato i turni dall'altra parte.
      qc.invalidateQueries({ queryKey: qk.assignments.all });
      qc.invalidateQueries({ queryKey: qk.shifts.all });
    },
  });
}
