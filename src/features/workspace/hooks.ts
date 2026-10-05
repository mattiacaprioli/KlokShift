import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  createFirstVenue,
  getMyContext,
  getStaffCanChat,
  getWorkspaceAccess,
  respondToInvite,
  setStaffCanChat,
  startWorkspaceTrial,
  transferOwnership,
} from "./api";
import { canUseWorkspaceOperations, workspaceAccessRefetchDelay } from "./access";

/**
 * Cache per azienda; quella dell'account si svuota al cambio di sessione.
 * Il chiamante usa `access`/i diritti espliciti: un errore di refresh non
 * autorizza a continuare con un vecchio diritto in cache.
 * `isAccessPending` è falso senza azienda, quindi non blocca il primo setup.
 */
export function useWorkspaceAccess(workspaceId: string | undefined) {
  const enabled = !!workspaceId;
  const query = useQuery({
    queryKey: qk.workspaceAccess.byWorkspace(workspaceId ?? ""),
    queryFn: () => getWorkspaceAccess(workspaceId as string),
    enabled,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (current) => current.state.status === "error"
      ? false
      : workspaceAccessRefetchDelay(current.state.data, Date.now(), current.state.dataUpdatedAt),
    // Cambi riservati al servizio non emettono realtime pubblico. Rileggere
    // al focus/reconnect anche per le concessioni permanenti.
    staleTime: 0,
  });
  const access = enabled && !query.isError ? query.data : undefined;
  return {
    ...query,
    access,
    isAccessPending: enabled && query.isPending,
    canOperate: access?.can_operate ?? false,
    canUseOperations: canUseWorkspaceOperations(access),
    canRead: access?.can_read ?? false,
    canCompleteAttendance: access?.can_complete_attendance ?? false,
  };
}

/** Nessuna attivazione locale: l'esito valido invalida il read model server. */
export function useStartWorkspaceTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startWorkspaceTrial,
    onSuccess: (_periodId, workspaceId) => Promise.all([
      qc.invalidateQueries({ queryKey: qk.workspaceAccess.byWorkspace(workspaceId) }),
      qc.invalidateQueries({ queryKey: qk.context.mine }),
    ]),
  });
}

/**
 * Le appartenenze di chi è in sessione. `enabled` spegne la query finché non c'è
 * un utente: senza sessione `get_my_context` risponde `not_authenticated`.
 *
 * ⚠️ Nella chiave non c'è l'id dell'utente: l'identità è la sessione, e la cache
 * si svuota al cambio di persona (`syncAccount` in `lib/auth.tsx`).
 */
export function useMyContext(enabled: boolean) {
  return useQuery({
    queryKey: qk.context.mine,
    queryFn: getMyContext,
    enabled,
  });
}

/** Cambiare un'appartenenza cambia tutto ciò che dipende da chi sono. */
function useInvalidateEverything() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useCreateFirstVenue() {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: createFirstVenue,
    onSuccess: invalidate,
  });
}

export function useRespondToInvite() {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: (vars: { memberId: string; accept: boolean }) =>
      respondToInvite(vars.memberId, vars.accept),
    onSuccess: invalidate,
  });
}

export function useTransferOwnership() {
  const invalidate = useInvalidateEverything();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: string; memberId: string }) =>
      transferOwnership(vars.workspaceId, vars.memberId),
    onSuccess: (_result, vars) => Promise.all([
      qc.resetQueries({ queryKey: qk.workspaceAccess.byWorkspace(vars.workspaceId) }),
      invalidate(),
    ]),
  });
}

/** L'interruttore della chat fra colleghi (lettura). */
export function useStaffCanChat(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.context.staffCanChat(workspaceId ?? ""),
    queryFn: () => getStaffCanChat(workspaceId as string),
    enabled: !!workspaceId,
  });
}

/** Spegnerlo non cancella niente: le conversazioni aperte restano leggibili. */
export function useSetStaffCanChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { workspaceId: string; enabled: boolean }) =>
      setStaffCanChat(vars.workspaceId, vars.enabled),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.context.staffCanChat(vars.workspaceId) });
      // La rubrica si accorcia (o si allunga) subito dopo.
      qc.invalidateQueries({ queryKey: qk.chat.all });
    },
  });
}
