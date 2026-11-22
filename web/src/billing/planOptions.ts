import { PLAN_BANDS, planRank, type SalePlan } from "@/features/workspace/planBands";

const SALE_PLANS: SalePlan[] = ["base", "team", "large"];

/** Fasce che si possono comprare: nascoste quelle col limite sotto l'uso attuale. */
export function purchaseOptions(people: number): SalePlan[] {
  return SALE_PLANS.filter((p) => PLAN_BANDS[p].people === null || people <= PLAN_BANDS[p].people!);
}

/** Aumento: solo fasce più grandi di quella attuale. */
export function increaseOptions(current: SalePlan): SalePlan[] {
  return SALE_PLANS.filter((p) => planRank(p) > planRank(current));
}

/** Cambio dal prossimo rinnovo: stessa fascia o più piccola. */
export function scheduledOptions(current: SalePlan): SalePlan[] {
  return SALE_PLANS.filter((p) => planRank(p) <= planRank(current));
}

/** Nella fascia più alta, vicino al limite, non c'è un'altra fascia da comprare. */
export function needsCustomAgreement(current: SalePlan, people: number): boolean {
  return current === "large" && people >= 98;
}

/**
 * Da sé si comprano fino a 5 sedi in tutto (1 + 4 aggiuntive): oltre serve un
 * accordo scritto, come dicono i termini. Gemello di `billing_venues_need_agreement`
 * nelle RPC di acquisto e cambio; le concessioni del fondatore non hanno tetto.
 */
export const SELF_SERVE_MAX_VENUES = 5;
export const VENUES_AGREEMENT_MESSAGE =
  `Oltre ${SELF_SERVE_MAX_VENUES} sedi serve un accordo su misura: scrivi a info@klokshift.com`;
export const PEOPLE_AGREEMENT_MESSAGE =
  `Oltre ${PLAN_BANDS.large.people} persone serve un accordo su misura: scrivi a info@klokshift.com`;

/** Sedi totali scritte nel campo: valide, sotto il minimo o oltre il self-serve. */
export function checkVenues(raw: string, min: number): "ok" | "too_few" | "agreement" {
  const count = Number(raw);
  if (raw.trim() === "" || !Number.isSafeInteger(count) || count < min) {
    return min > SELF_SERVE_MAX_VENUES ? "agreement" : "too_few";
  }
  return count > SELF_SERVE_MAX_VENUES ? "agreement" : "ok";
}
