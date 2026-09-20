import { useMutation, useQueryClient } from "@tanstack/react-query";
import { leaveVenue } from "./api";

/**
 * Lascia una sede. Cambia chi sono (le appartenenze) e ciò che vedo (turni,
 * agenda, colleghi), quindi si invalida tutto: come per gli inviti.
 */
export function useLeaveVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { memberId: string; venueId: string }) =>
      leaveVenue(vars.memberId, vars.venueId),
    onSuccess: () => qc.invalidateQueries(),
  });
}
