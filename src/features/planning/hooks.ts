import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { getStaffPlanning, setVenueSeesPlanning } from "./api";

/**
 * Il planning delle sedi del professionista, da `from` a `to` inclusi.
 *
 * `enabled` di proposito: la tab Turni lo carica solo quando si passa a «Il
 * locale». È una RPC in più su una schermata che si apre a ogni avvio, e la
 * stragrande maggioranza delle aperture serve a guardare i **propri** turni.
 */
export function useStaffPlanning(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: qk.planning.range(from, to),
    queryFn: () => getStaffPlanning(from, to),
    enabled: enabled && !!from && !!to,
  });
}

/**
 * Manager: condivide (o no) il planning della sede con l'organico.
 *
 * Invalida `venues.mine` perché lo switch legge il valore da `useOwnerVenues()`,
 * che è quella query. Il planning dei professionisti sta su altri dispositivi:
 * lo rivedranno al prossimo caricamento, come il logo (`useUpdateVenueLogo`).
 */
export function useSetVenueSeesPlanning(ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; visible: boolean }) =>
      setVenueSeesPlanning(vars.venueId, vars.visible),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.venues.mine(ownerId) });
    },
  });
}
