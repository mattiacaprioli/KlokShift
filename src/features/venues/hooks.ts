import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  getMyClosedVenues,
  getMyVenues,
  saveVenue,
  setVenueClosed,
  updateVenueLogo,
  type VenueInput,
} from "./api";

/**
 * Le sedi a cui si ha accesso — proprie o delegate. `enabled: false` tiene la
 * query spenta (è così che `OwnerVenuesProvider` sta zitto quando l'utente è un
 * professionista).
 *
 * ⚠️ Non usarlo direttamente nelle schermate: passa da `useOwnerVenues()`, che
 * espone anche `venueIds` e `venuesKey` — le due forme che servono a interrogare
 * e a mettere in cache i turni di tutte le sedi insieme.
 */
export function useMyVenues(
  enabled: boolean,
  userId: string,
  /**
   * Le sedi delegate, da `venue_access`. ⚠️ Non entrano nella query key: la
   * chiave resta `qk.venues.mine` perché l'identità di questa lista è la
   * sessione, e la cache si svuota al cambio di persona (`syncAccount` in
   * `lib/auth.tsx`). Aggiungerle qui vorrebbe dire una voce di cache nuova ogni
   * volta che il titolare tocca un permesso.
   *
   * ⚠️ Il rovescio: cambiare questi id **non** rifà la query. Per questo
   * `OwnerVenuesProvider` la accende solo quando gli accessi sono arrivati.
   */
  accessVenueIds: readonly string[]
) {
  return useQuery({
    queryKey: qk.venues.mine,
    queryFn: () => getMyVenues(userId, accessVenueIds),
    enabled,
  });
}

export function useMyClosedVenues(ownerId: string) {
  return useQuery({
    queryKey: qk.venues.closed(ownerId),
    queryFn: () => getMyClosedVenues(ownerId),
    enabled: !!ownerId,
  });
}

/**
 * Chiude o riapre una sede. Invalida entrambe le liste: una sede che si chiude
 * esce da `mine` ed entra in `closed`, e il contrario quando si riapre.
 */
export function useSetVenueClosed(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; closed: boolean }) =>
      setVenueClosed(vars.venueId, vars.closed),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
      qc.invalidateQueries({ queryKey: qk.venues.closed(ownerId) });
    },
  });
}

/**
 * Logo della sede. Invalida solo `venues.mine`: il logo compare anche sulle
 * card turno del professionista, ma quelle sono query sue, su un altro
 * dispositivo — le rivedrà al prossimo caricamento.
 */
export function useUpdateVenueLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; logoUrl: string | null }) =>
      updateVenueLogo(vars.venueId, vars.logoUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
    },
  });
}

export function useSaveVenue(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { input: VenueInput; venueId?: string }) =>
      saveVenue(ownerId, vars.input, vars.venueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine });
    },
  });
}
