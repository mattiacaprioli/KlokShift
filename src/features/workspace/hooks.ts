import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  createFirstVenue,
  getMyContext,
  respondToInvite,
  transferOwnership,
} from "./api";

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
  return useMutation({
    mutationFn: (vars: { workspaceId: string; memberId: string }) =>
      transferOwnership(vars.workspaceId, vars.memberId),
    onSuccess: invalidate,
  });
}
