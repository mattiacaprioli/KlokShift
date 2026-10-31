/**
 * Cambio dal prossimo rinnovo (piano più piccolo, meno sedi, altro ciclo):
 * regole condivise per spiegarlo prima della conferma. Il server le ripete
 * (`private.billing_scheduled_rules_error`) e resta lui a decidere; qui servono
 * solo a dire il motivo concreto prima di chiedere l'anteprima a Paddle.
 * Non importa Expo/React Native.
 */
export type PlanTarget = { plan: "base" | "team"; interval: "month" | "year"; extraVenues: number };

/** Persone uniche del piano Base, come in `private.workspace_access_at`. */
const BASE_PEOPLE = 30;

/** Il primo motivo per cui la scelta non si può programmare, o `null`. */
export function scheduledChangeBlocker(input: {
  current: PlanTarget; target: PlanTarget; people: number; openVenues: number;
}): string | null {
  const { current, target, people, openVenues } = input;
  if (target.plan === current.plan && target.interval === current.interval &&
      target.extraVenues === current.extraVenues) {
    return "È la stessa scelta che hai già.";
  }
  if ((target.plan === "team" && current.plan === "base") || target.extraVenues > current.extraVenues) {
    return "Per aumentare piano o sedi usa il modulo dell'aumento: vale subito.";
  }
  if (target.plan === "base" && people > BASE_PEOPLE) {
    return `Hai ${people} persone nel team: il piano Base ne comprende ${BASE_PEOPLE}.`;
  }
  const venues = 1 + target.extraVenues;
  if (openVenues > venues) {
    return `Hai ${openVenues} sedi aperte: chiudine ${openVenues - venues} prima di ridurre.`;
  }
  return null;
}

/** «Base · annuale, 1 sede», «Team · mensile, 3 sedi». */
export function describePlanTarget(t: PlanTarget): string {
  const venues = 1 + t.extraVenues;
  return `${t.plan === "base" ? "Base" : "Team"} · ${t.interval === "year" ? "annuale" : "mensile"}, ` +
    `${venues} ${venues === 1 ? "sede" : "sedi"}`;
}

/** Il titolare annulla da sé solo prima dell'invio a Paddle, come `billing_cancel_scheduled_change`. */
export function pendingChangeCancellable(
  change: { status: "pending" | "applied"; cancel_until: string }, now: Date = new Date()
): boolean {
  return change.status === "pending" && now.getTime() < Date.parse(change.cancel_until);
}
