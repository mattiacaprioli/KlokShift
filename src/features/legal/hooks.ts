import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { acceptLegalTerms, getPendingLegalAcceptances } from "./api";

/** Con l'id utente nella chiave: dopo un cambio di account non vale la risposta di prima. */
export function usePendingLegalAcceptances(userId: string | undefined) {
  return useQuery({
    queryKey: qk.legal.pending(userId ?? ""),
    queryFn: getPendingLegalAcceptances,
    enabled: !!userId,
  });
}

export function useAcceptLegalTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptLegalTerms,
    // Anche un rifiuto (versione superata) deve rileggere: il gate mostra il testo nuovo.
    onSettled: () => qc.invalidateQueries({ queryKey: qk.legal.all }),
  });
}
