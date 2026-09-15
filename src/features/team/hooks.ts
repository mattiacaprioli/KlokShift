import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  addTeamMember,
  addTeamVenue,
  getMyVenueAccess,
  getPersonAccess,
  getTeam,
  promoteStaffPerson,
  revokeTeamAccess,
  sendTeamInvite,
  updateTeamPermissions,
  type AddTeamMemberInput,
  type TeamMember,
  type TeamPermissions,
} from "./api";

/** I collaboratori del titolare. Lista vuota per chi non ne ha. */
export function useTeam(ownerId: string) {
  return useQuery({
    queryKey: qk.team.byOwner(ownerId),
    queryFn: () => getTeam(ownerId),
    enabled: !!ownerId,
  });
}

/**
 * I **miei** accessi delegati: è ciò che dice a `OwnerVenuesProvider` cosa posso
 * fare su quali sedi. Vuoto per il titolare.
 */
export function useMyVenueAccess(userId: string) {
  return useQuery({
    queryKey: qk.team.mine,
    queryFn: () => getMyVenueAccess(userId),
    enabled: !!userId,
  });
}

/**
 * Invalidazione condivisa da tutte le mutation dei collaboratori.
 *
 * Due chiavi e non una: `team.all` è la lista del titolare, `venues.mine` è
 * quella delle sedi — che per chi riceve o perde un accesso cambia. La seconda
 * riguarda un altro dispositivo, quindi non fa nulla qui e non costa niente:
 * serve al caso in cui il titolare modifichi i **propri** accessi.
 */
function useTeamInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.team.all });
    qc.invalidateQueries({ queryKey: qk.venues.mine });
  };
}

/** Gli accessi che il titolare ha dato a una persona dell'organico (F3). */
export function usePersonAccess(
  ownerId: string | undefined,
  userId: string | null | undefined
) {
  return useQuery({
    queryKey: qk.team.person(ownerId ?? "", userId ?? ""),
    queryFn: () => getPersonAccess(ownerId as string, userId as string),
    enabled: !!ownerId && !!userId,
  });
}

/** Promuove (o ripromuove) un membro dell'organico su una sede. */
export function usePromoteStaffPerson() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: promoteStaffPerson,
    onSuccess: invalidate,
  });
}

export function useAddTeamMember() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (input: AddTeamMemberInput) => addTeamMember(input),
    onSuccess: invalidate,
  });
}

export function useAddTeamVenue(ownerId: string) {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (vars: {
      member: TeamMember;
      venueId: string;
      permissions: TeamPermissions;
    }) => addTeamVenue(ownerId, vars.member, vars.venueId, vars.permissions),
    onSuccess: invalidate,
  });
}

export function useUpdateTeamPermissions() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (vars: {
      accessId: string;
      permissions: Partial<TeamPermissions>;
    }) => updateTeamPermissions(vars.accessId, vars.permissions),
    onSuccess: invalidate,
  });
}

export function useRevokeTeamAccess() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (accessIds: string[]) => revokeTeamAccess(accessIds),
    onSuccess: invalidate,
  });
}

/** Rimanda l'email d'invito. Invalida per aggiornare `invited_at`. */
export function useSendTeamInvite() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (accessId: string) => sendTeamInvite(accessId),
    onSuccess: invalidate,
  });
}
