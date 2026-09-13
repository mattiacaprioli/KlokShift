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
 * Le sedi del titolare. Passare `""` come ownerId tiene la query spenta (è così
 * che `ActiveVenueProvider` sta zitto quando l'utente è un professionista).
 *
 * Tiene la chiave `qk.venues.mine(ownerId)` del vecchio `useMyVenue`: la forma è
 * cambiata (una lista invece di una riga) ma l'identità della query no, quindi
 * `useSaveVenue` e `useUpdateVenueLogo` continuano a invalidare la cosa giusta
 * senza una riga di modifica.
 *
 * ⚠️ Non usarlo direttamente nelle schermate: passa da `useActiveVenue()`, che
 * sa anche **quale** sede è quella attiva.
 */
export function useMyVenues(ownerId: string) {
  return useQuery({
    queryKey: qk.venues.mine(ownerId),
    queryFn: () => getMyVenues(ownerId),
    enabled: !!ownerId,
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
      qc.invalidateQueries({ queryKey: qk.venues.mine(ownerId) });
      qc.invalidateQueries({ queryKey: qk.venues.closed(ownerId) });
    },
  });
}

/**
 * Logo del locale. Invalida solo `venues.mine`: il logo compare anche sulle
 * card turno del professionista, ma quelle sono query sue, su un altro
 * dispositivo — le rivedrà al prossimo caricamento.
 */
export function useUpdateVenueLogo(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; logoUrl: string | null }) =>
      updateVenueLogo(vars.venueId, vars.logoUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine(ownerId) });
    },
  });
}

export function useSaveVenue(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { input: VenueInput; venueId?: string }) =>
      saveVenue(ownerId, vars.input, vars.venueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine(ownerId) });
    },
  });
}
