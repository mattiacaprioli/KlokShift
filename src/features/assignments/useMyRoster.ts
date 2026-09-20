import { useMemo } from "react";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";

/**
 * Le **mie** righe di organico (`venue_members.id`), una per sede in cui chi
 * guarda lavora.
 *
 * È ciò che serve al filtro «I miei turni» e al badge «Tu»: chi gestisce può
 * mettersi in turno, e le assegnazioni puntano a `venue_member_id`. Le legge dal
 * contesto (`get_my_context().works`), che è già in cache: nessuna query in più
 * e nessun bisogno di caricare l'organico dell'azienda per sapere chi sono.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa.
 * ⚠️ `reactCompiler: true` — nessun hook condizionale.
 */
export function useMyRosterIds(): ReadonlySet<string> {
  const { memberships } = useOwnerVenues();
  return useMemo(
    () =>
      new Set(
        memberships.flatMap((m) => m.works.map((w) => w.venue_member_id))
      ),
    [memberships]
  );
}
