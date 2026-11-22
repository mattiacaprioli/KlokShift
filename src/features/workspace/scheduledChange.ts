import { PLAN_BANDS, planRank, type SalePlan } from "./planBands";

/**
 * Cambio dal prossimo rinnovo (piano più piccolo, meno sedi, altro ciclo):
 * regole condivise per spiegarlo prima della conferma. Il server le ripete
 * (`private.billing_scheduled_rules_error`) e resta lui a decidere; qui servono
 * solo a dire il motivo concreto prima di chiedere l'anteprima a Paddle.
 * Non importa Expo/React Native.
 */
export type PlanTarget = { plan: SalePlan; interval: "month" | "year"; extraVenues: number };

/** Il primo motivo per cui la scelta non si può programmare, o `null`. */
export function scheduledChangeBlocker(input: {
  current: PlanTarget; target: PlanTarget; people: number; openVenues: number;
}): string | null {
  const { current, target, people, openVenues } = input;
  if (target.plan === current.plan && target.interval === current.interval &&
      target.extraVenues === current.extraVenues) {
    return "È la stessa scelta che hai già.";
  }
  if (planRank(target.plan) > planRank(current.plan) || target.extraVenues > current.extraVenues) {
    return "Per aumentare piano o sedi usa il modulo dell'aumento: vale subito.";
  }
  const { label, people: capacity } = PLAN_BANDS[target.plan];
  if (capacity !== null && people > capacity) {
    return `Hai ${people} persone nel team: la fascia ${label} ne comprende ${capacity}.`;
  }
  const venues = 1 + target.extraVenues;
  if (openVenues > venues) {
    return `Hai ${openVenues} sedi aperte: chiudine ${openVenues - venues} prima di ridurre.`;
  }
  return null;
}

/** «Piccola · annuale, 1 sede», «Media · mensile, 3 sedi». */
export function describePlanTarget(t: PlanTarget): string {
  const venues = 1 + t.extraVenues;
  return `${PLAN_BANDS[t.plan].label} · ${t.interval === "year" ? "annuale" : "mensile"}, ` +
    `${venues} ${venues === 1 ? "sede" : "sedi"}`;
}

/** Il titolare annulla da sé solo prima dell'invio a Paddle, come `billing_cancel_scheduled_change`. */
export function pendingChangeCancellable(
  change: { status: "pending" | "applied"; cancel_until: string }, now: Date = new Date()
): boolean {
  return change.status === "pending" && now.getTime() < Date.parse(change.cancel_until);
}
