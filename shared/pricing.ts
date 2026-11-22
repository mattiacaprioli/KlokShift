/** Listino approvato, solo per i flussi web. Non concede diritti né crea addebiti. */
export const PLAN_PRICES = {
  base: { monthly: 29, annual: 290 },
  team: { monthly: 49, annual: 490 },
  large: { monthly: 89, annual: 890 },
} as const;
export const EXTRA_VENUE_PRICES = { monthly: 15, annual: 150 } as const;
export type PricingPlan = keyof typeof PLAN_PRICES;
export type BillingCycle = "monthly" | "annual";

/**
 * Sconto «clienti fondatori» (docs/MONETIZATION.md §2-bis): le prime 10 aziende
 * che pagano, per 24 mesi. Chi ne ha diritto lo decide solo il server
 * (`get_founder_offer`, lo sconto Paddle nel checkout): qui c'è solo il conto.
 */
export const FOUNDER_OFFER = { percent: 30, months: 24, seats: 10 } as const;

/**
 * Importi IVA esclusa; capacità concessa e totale del checkout saranno verificati dal server.
 * `total` è quello da pagare (scontato e arrotondato al centesimo per i fondatori),
 * `listTotal` quello di listino.
 */
export function quotePlan(plan: PricingPlan, cycle: BillingCycle, venues: number, options: { founder?: boolean } = {}) {
  if (!Object.hasOwn(PLAN_PRICES, plan) || !Object.hasOwn(EXTRA_VENUE_PRICES, cycle) ||
      !Number.isSafeInteger(venues) || venues < 1) throw new Error("invalid_price_quote");
  const listTotal = PLAN_PRICES[plan][cycle] + EXTRA_VENUE_PRICES[cycle] * (venues - 1);
  if (!Number.isSafeInteger(listTotal * 100)) throw new Error("invalid_price_quote");
  // In centesimi interi: 49 × 0,7 in virgola mobile non fa 34,3.
  const total = options.founder
    ? Math.round(listTotal * (100 - FOUNDER_OFFER.percent)) / 100
    : listTotal;
  return { total, listTotal, monthlyEquivalent: cycle === "annual" ? total / 12 : total };
}

export function formatEuro(amount: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
}
