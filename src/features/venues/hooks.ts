import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  createVenue,
  getMyClosedVenues,
  getMyVenues,
  setVenueClosed,
  updateVenue,
  updateVenueLogo,
  type VenueInput,
} from "./api";

/**
 * Le sedi che si gestiscono. `enabled: false` tiene la query spenta (è così che
 * `OwnerVenuesProvider` sta zitto per chi non gestisce niente).
 *
 * ⚠️ Non usarlo direttamente nelle schermate: passa da `useOwnerVenues()`, che
 * espone anche `venueIds` e `venuesKey` — le due forme che servono a interrogare
 * e a mettere in cache i turni di tutte le sedi insieme.
 *
 * Gli id canonici entrano nella query key: quando contesto o permessi cambiano,
 * React Query non può mostrare la lista dello scope precedente. `mine` resta il
 * prefisso comune usato dalle invalidazioni.
 */
export function useMyVenues(enabled: boolean, venueIds: readonly string[]) {
  const scope = [...new Set(venueIds)].sort();
  return useQuery({
    queryKey: qk.venues.mineByIds(scope),
    queryFn: () => (scope.length > 0 ? getMyVenues(scope) : Promise.resolve([])),
    enabled,
  });
}

export function useMyClosedVenues(workspaceId: string) {
  return useQuery({
    queryKey: qk.venues.closed(workspaceId),
    queryFn: () => getMyClosedVenues(workspaceId),
    enabled: !!workspaceId,
  });
}

/** Cosa cambia quando l'insieme o i dati delle sedi cambiano. */
function useInvalidateVenues(workspaceId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.context.mine }),
      qc.invalidateQueries({ queryKey: qk.venues.mine }),
      qc.invalidateQueries({ queryKey: qk.venues.closed(workspaceId) }),
    ]);
}

/**
 * Chiude o riapre una sede. Invalida entrambe le liste: una sede che si chiude
 * esce da `mine` ed entra in `closed`, e il contrario quando si riapre.
 */
export function useSetVenueClosed(workspaceId: string) {
  const invalidate = useInvalidateVenues(workspaceId);
  return useMutation({
    mutationFn: (vars: { venueId: string; closed: boolean }) =>
      setVenueClosed(vars.venueId, vars.closed),
    onSuccess: invalidate,
  });
}

/**
 * Logo della sede. Il logo compare anche sulle card turno del professionista,
 * ma quelle sono query sue, su un altro dispositivo: le rivedrà al prossimo
 * caricamento.
 */
export function useUpdateVenueLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; logoUrl: string | null }) =>
      updateVenueLogo(vars.venueId, vars.logoUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
      qc.invalidateQueries({ queryKey: qk.context.mine });
    },
  });
}

/**
 * Salva una sede: la crea (`createVenue`) o ne modifica i dati (`updateVenue`).
 * Il nome è quello di prima (`useSaveVenue`) perché è ciò che i form già
 * chiamano; cambia solo il primo argomento, che ora è l'azienda.
 */
export function useSaveVenue(workspaceId: string) {
  const invalidate = useInvalidateVenues(workspaceId);
  return useMutation({
    mutationFn: async (vars: { input: VenueInput; venueId?: string }) => {
      if (vars.venueId) return updateVenue(vars.venueId, vars.input);
      const id = await createVenue(workspaceId, vars.input);
      return { id };
    },
    onSuccess: invalidate,
  });
}
