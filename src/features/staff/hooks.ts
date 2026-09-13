import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import type { TablesInsert, TablesUpdate } from "@/types/database";
import {
  addPersonToVenue,
  addStaffToVenue,
  findWaiterByEmail,
  getMyDocumentScopes,
  getMyEmployers,
  getMyPendingInvites,
  getOwnerPeople,
  getStaffPerson,
  getVenueStaff,
  leaveVenue,
  removeStaffMember,
  respondToInvite,
  updateStaffMember,
  updateStaffPerson,
} from "./api";

/**
 * Waiter: le sue cartelle documenti, una per datore di lavoro.
 *
 * Sotto `qk.documents.*` e non `qk.staff.*` perché è la lista della schermata
 * documenti: invalidarla insieme ai documenti è quello che serve, e le
 * invalidazioni dell'organico non la riguardano.
 */
export function useMyDocumentScopes(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.documents.scopes(waiterId ?? ""),
    queryFn: () => getMyDocumentScopes(waiterId as string),
    enabled: !!waiterId,
  });
}

/** Waiter: the venues where they are confirmed staff ("I tuoi locali"). */
export function useMyEmployers(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.employers(waiterId ?? ""),
    queryFn: () => getMyEmployers(waiterId as string),
    enabled: !!waiterId,
  });
}

/**
 * Manager: tutte le sue persone, con le sedi in cui lavorano.
 *
 * Serve dove il perimetro è il **titolare** e non la sede: aggiungere a Milano chi
 * si ha già a Roma, e scegliere un destinatario in chat (il thread è per persona).
 */
export function useOwnerPeople(ownerId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.people(ownerId ?? ""),
    queryFn: () => getOwnerPeople(ownerId as string),
    enabled: !!ownerId,
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

/** Persona nuova + prima appartenenza (scheda manuale, o invito per email). */
export function useAddStaffToVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addStaffToVenue,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

/** Una persona che il titolare ha già, aggiunta a un'altra delle sue sedi. */
export function useAddPersonToVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TablesInsert<"staff_members">) =>
      addPersonToVenue(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

/**
 * L'anagrafica: nome, telefono, note. Invalida tutto `staff.all` e non solo la
 * sede corrente, perché la persona può lavorare in più sedi e il trigger ha
 * appena riscritto il mirror su ognuna.
 */
export function useUpdateStaffPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; fields: TablesUpdate<"staff_people"> }) =>
      updateStaffPerson(vars.id, vars.fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

/** Quel che è della singola sede: tipo di impiego, stato del collegamento. */
export function useUpdateStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; fields: TablesUpdate<"staff_members"> }) =>
      updateStaffMember(vars.id, vars.fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.staff.all }),
  });
}

export function useRemoveStaffMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeStaffMember(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      // La rimozione cancella a cascata le sue assegnazioni e il trigger
      // aggiorna i coperti dei turni: senza realtime resterebbero stali.
      qc.invalidateQueries({ queryKey: qk.assignments.all });
      qc.invalidateQueries({ queryKey: qk.shifts.all });
    },
  });
}

/** Manager: search a waiter by exact email (on-demand). */
export function useFindWaiterByEmail() {
  return useMutation({
    mutationFn: (email: string) => findWaiterByEmail(email),
  });
}

/** Waiter: their pending staff invites. */
export function useMyPendingInvites(waiterId: string | undefined) {
  return useQuery({
    queryKey: qk.staff.invites(waiterId ?? ""),
    queryFn: () => getMyPendingInvites(waiterId as string),
    enabled: !!waiterId,
  });
}

/** Waiter: accept/decline a staff invite, then refresh invites + notifications. */
export function useRespondToInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { staffId: string; accept: boolean }) =>
      respondToInvite(vars.staffId, vars.accept),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

/** Waiter: resign from a venue's staff, then refresh "I tuoi locali" + assignments. */
export function useLeaveVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string) => leaveVenue(staffId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.staff.all });
      qc.invalidateQueries({ queryKey: qk.assignments.all });
    },
  });
}
