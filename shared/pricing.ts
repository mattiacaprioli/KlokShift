/** Listino approvato, solo per i flussi web. Non concede diritti né crea addebiti. */
export const PLAN_PRICES = {
  base: { monthly: 29, annual: 290 },
  team: { monthly: 49, annual: 490 },
} as const;
export const EXTRA_VENUE_PRICES = { monthly: 15, annual: 150 } as const;
export type PricingPlan = keyof typeof PLAN_PRICES;
export type BillingCycle = "monthly" | "annual";

/** Importi IVA esclusa; capacità concessa e totale del checkout saranno verificati dal server. */
export function quotePlan(plan: PricingPlan, cycle: BillingCycle, venues: number) {
  if (!Object.hasOwn(PLAN_PRICES, plan) || !Object.hasOwn(EXTRA_VENUE_PRICES, cycle) ||
      !Number.isSafeInteger(venues) || venues < 1) throw new Error("invalid_price_quote");
  const total = PLAN_PRICES[plan][cycle] + EXTRA_VENUE_PRICES[cycle] * (venues - 1);
  if (!Number.isSafeInteger(total * 100)) throw new Error("invalid_price_quote");
  return { total, monthlyEquivalent: cycle === "annual" ? total / 12 : total };
}

export function formatEuro(amount: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
}
