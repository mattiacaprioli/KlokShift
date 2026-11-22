/**
 * Le fasce di dimensione dell'azienda: Piccola, Media, Grande e «Su misura»
 * (solo concessioni del fondatore, senza limite). Gemello **manuale** di
 * `private.plan_people_limit` in SQL: i limiti di persone cambiano insieme.
 * Niente prezzi qui: lo importa anche l'app nativa (App Store 3.1.3); il
 * listino sta in `shared/pricing.ts`, solo web. Non importa Expo/React Native.
 */
export type SalePlan = "base" | "team" | "large";
export type AccessPlan = SalePlan | "custom";

export const PLAN_BANDS: Record<AccessPlan, { label: string; people: number | null }> = {
  base: { label: "Piccola", people: 15 },
  team: { label: "Media", people: 40 },
  large: { label: "Grande", people: 100 },
  custom: { label: "Su misura", people: null },
};

const RANKS: Record<SalePlan, 1 | 2 | 3> = { base: 1, team: 2, large: 3 };

/** Posizione della fascia in vendita, dalla più piccola: serve a dire se si sale o si scende. */
export function planRank(p: SalePlan): 1 | 2 | 3 {
  return RANKS[p];
}

/** «Piccola · fino a 15 persone», «Su misura · senza limite di persone». */
export function planOptionLabel(p: AccessPlan): string {
  const { label, people } = PLAN_BANDS[p];
  return `${label} · ${people === null ? "senza limite di" : `fino a ${people}`} persone`;
}

/** «Media», o «piano non assegnato» per un piano mancante o sconosciuto a questa versione. */
export function planBandLabel(p: string | null | undefined): string {
  return p && p in PLAN_BANDS ? PLAN_BANDS[p as AccessPlan].label : "piano non assegnato";
}

/**
 * La fascia più piccola che contiene `people` persone; «Su misura» oltre
 * Grande o se l'uso non è noto (non si propone una fascia che rifiuterebbe).
 */
export function smallestBandFor(people: number | null | undefined): AccessPlan {
  if (people == null) return "custom";
  return (["base", "team", "large"] as const).find((p) => people <= PLAN_BANDS[p].people!) ?? "custom";
}
