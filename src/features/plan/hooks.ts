import { useRouter } from "expo-router";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useDevPlanOverride, type PlanTier } from "./devOverride";

export type { PlanTier };

/** Rotta del paywall (unica sorgente, usata da gate e componenti). */
export const PAYWALL_ROUTE = "/(manager)/pro" as const;

/**
 * Piano effettivo: quello **dell'azienda** che si gestisce (`workspaces.plan`,
 * default 'pro' finché la monetizzazione non è attiva → oggi tutti sbloccati),
 * non quello di chi guarda: un collaboratore su un account Pro non sblocca
 * niente in un'azienda Free, e non c'è modo di scrivere il piano dal client.
 * In sviluppo un override locale può simulare 'free' per vedere i lucchetti.
 */
export function usePlan(): PlanTier {
  const { plan } = useOwnerVenues();
  const override = useDevPlanOverride();
  if (override) return override;
  return plan === "free" ? "free" : "pro";
}

export function useIsPro(): boolean {
  return usePlan() === "pro";
}

/**
 * Guardia per le funzioni Pro: `gate(action)` restituisce un handler che esegue
 * `action` se l'utente è Pro, altrimenti apre il paywall. `isPro` per rendere il
 * lucchetto nell'UI.
 */
export function useProGate() {
  const isPro = useIsPro();
  const router = useRouter();

  function gate(action: () => void) {
    return () => {
      if (isPro) action();
      else router.push(PAYWALL_ROUTE);
    };
  }

  function openPaywall() {
    router.push(PAYWALL_ROUTE);
  }

  return { isPro, gate, openPaywall };
}
