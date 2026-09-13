import type { PlanTier } from "@/features/plan/devOverride";

/**
 * **Unico punto di gate della seconda sede.**
 *
 * Oggi non c'è alcun limite: un titolare può aprire tutte le sedi che vuole. Il
 * file esiste perché il giorno in cui il limite arriverà, il diff sia questo e
 * nient'altro — i due chiamanti (`(manager)/venue/new.tsx` e la pagina web
 * `/locale/nuovo`) non cambieranno di una riga.
 *
 * Puro di proposito: nessun router, nessun Expo, nessun hook. È la ragione per
 * cui la dashboard web lo importa verbatim.
 *
 * ⚠️ Due cose da ricordare quando il limite diventerà reale:
 *
 *  1. `profiles.plan` è **scrivibile dal client** (la policy su `profiles` è
 *     `ALL id = auth.uid()`), quindi un gate solo qui sarebbe cosmetico: servirà
 *     anche un controllo lato DB — un trigger su `venues` o una RPC DEFINER per
 *     la creazione.
 *  2. `venueCount` conta solo le sedi **aperte** (`getMyVenues` filtra
 *     `closed_at is null`). Chiudere e riaprire non deve diventare il modo di
 *     aggirare il limite: quando esisterà, anche la riapertura dovrà passare da
 *     qui.
 */
export const VENUE_LIMIT: Record<PlanTier, number> = {
  free: Number.POSITIVE_INFINITY,
  pro: Number.POSITIVE_INFINITY,
};

export type VenueGate = { allowed: true } | { allowed: false; reason: string };

export function canCreateVenue(args: {
  /** Quante sedi **aperte** ha già. */
  venueCount: number;
  plan: PlanTier;
}): VenueGate {
  const limit = VENUE_LIMIT[args.plan];
  if (args.venueCount < limit) return { allowed: true };
  return {
    allowed: false,
    reason:
      limit === 1
        ? "Il tuo piano include un solo locale. Passa a Pro per aggiungerne altri."
        : `Il tuo piano include ${limit} locali. Passa a Pro per aggiungerne altri.`,
  };
}
