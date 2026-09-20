import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  addTeamMember,
  getMemberAccess,
  getTeam,
  revokeTeamAccess,
  sendTeamInvite,
  setTeamAccess,
  type AddTeamMemberInput,
  type TeamPermissions,
} from "./api";
import type { VenueScope } from "@/features/workspace/types";

/** I collaboratori dell'azienda. Lista vuota per chi non ne ha. */
export function useTeam(workspaceId: string) {
  return useQuery({
    queryKey: qk.team.byWorkspace(workspaceId),
    queryFn: () => getTeam(workspaceId),
    enabled: !!workspaceId,
  });
}

/** I permessi e l'ambito attuali di un membro: da dove parte la promozione. */
export function useMemberAccess(memberId: string | undefined) {
  return useQuery({
    queryKey: qk.team.member(memberId ?? ""),
    queryFn: () => getMemberAccess(memberId as string),
    enabled: !!memberId,
  });
}

/**
 * Invalidazione condivisa da tutte le mutation dei collaboratori.
 *
 * `team.all` è la lista del titolare, `context.mine` cambia per chi riceve,
 * perde o vede cambiare i propri permessi di gestione, `venues.mine` perché le
 * sedi gestite dipendono dal contesto.
 */
function useTeamInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.team.all });
    qc.invalidateQueries({ queryKey: qk.context.mine });
    qc.invalidateQueries({ queryKey: qk.venues.mine });
    // L'ambito «selezionate» può aver messo (o tolto) il collaboratore
    // dall'organico di una sede: vedi il commento su `addTeamMember`.
    qc.invalidateQueries({ queryKey: qk.staff.all });
  };
}

export function useAddTeamMember() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (input: AddTeamMemberInput) => addTeamMember(input),
    onSuccess: invalidate,
  });
}

/** Cambia permessi e ambito di un collaboratore, o promuove un dipendente. */
export function useSetTeamAccess() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (vars: {
      memberId: string;
      permissions: TeamPermissions;
      scope: VenueScope;
      venueIds: string[];
    }) => setTeamAccess(vars),
    onSuccess: invalidate,
  });
}

export function useRevokeTeamAccess() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (memberId: string) => revokeTeamAccess(memberId),
    onSuccess: invalidate,
  });
}

/** Rimanda il link d'invito. Invalida per aggiornare lo stato dell'invito. */
export function useSendTeamInvite() {
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (memberId: string) => sendTeamInvite(memberId),
    onSuccess: invalidate,
  });
}
