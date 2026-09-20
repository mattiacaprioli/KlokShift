import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { getMyWaiterProfile, saveWaiterProfile, type WaiterProfileInput } from "./api";

/**
 * Il proprio profilo professionale. Non esiste il gemello «per id di un altro»:
 * lo usavano le due schede che il gestore apriva su un professionista, e quelle
 * sono cadute col CV — chi ha la persona in azienda la guarda dalla scheda di
 * organico, dove i dati sono suoi e non una vetrina.
 */
export function useMyWaiterProfile(userId: string) {
  return useQuery({
    queryKey: qk.profile.mine(userId),
    queryFn: () => getMyWaiterProfile(userId),
  });
}

export function useSaveWaiterProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WaiterProfileInput) => saveWaiterProfile(userId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.profile.mine(userId) });
    },
  });
}
