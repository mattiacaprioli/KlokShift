/**
 * Riassunto dell'abbonamento per il titolare (`get_workspace_billing`): stato e
 * date, mai importi o identificativi Paddle. Il diritto resta quello di
 * `access.ts`; questo serve solo a spiegare rinnovi, disdette e pagamenti.
 * Non importa Expo/React Native.
 */
const STATUSES = ["active", "past_due", "paused", "canceled"] as const;
const PLANS = ["base", "team"] as const;
const INTERVALS = ["month", "year"] as const;
const ACTIONS = ["cancel", "pause", "resume"] as const;

export type WorkspaceBilling = {
  status: (typeof STATUSES)[number];
  plan: (typeof PLANS)[number];
  billing_interval: (typeof INTERVALS)[number];
  extra_venues: number;
  current_period_ends_at: string | null;
  scheduled_change: { action: (typeof ACTIONS)[number]; effective_at: string } | null;
  past_due_since: string | null;
  canceled_at: string | null;
  paused_at: string | null;
};

function invalid(): never {
  throw new Error("workspace_billing_invalid");
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : invalid();
}

function instant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : invalid();
}

/** `null` = nessun abbonamento mai avuto. Una risposta incoerente fallisce. */
export function parseWorkspaceBilling(value: unknown): WorkspaceBilling | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  const change = raw.scheduled_change;
  const billing: WorkspaceBilling = {
    status: oneOf(raw.status, STATUSES),
    plan: oneOf(raw.plan, PLANS),
    billing_interval: oneOf(raw.billing_interval, INTERVALS),
    extra_venues: typeof raw.extra_venues === "number" && Number.isSafeInteger(raw.extra_venues) &&
      raw.extra_venues >= 0 ? raw.extra_venues : invalid(),
    current_period_ends_at: instant(raw.current_period_ends_at),
    scheduled_change: change === null || change === undefined ? null : (() => {
      const c = change as Record<string, unknown>;
      const at = instant(c.effective_at);
      return at ? { action: oneOf(c.action, ACTIONS), effective_at: at } : invalid();
    })(),
    past_due_since: instant(raw.past_due_since),
    canceled_at: instant(raw.canceled_at),
    paused_at: instant(raw.paused_at),
  };
  if ((billing.status === "active" || billing.status === "past_due") && !billing.current_period_ends_at) {
    return invalid();
  }
  return billing;
}

/** Un abbonamento ancora aperto esclude un secondo acquisto. */
export function hasOpenSubscription(billing: WorkspaceBilling | null | undefined): boolean {
  return !!billing && billing.status !== "canceled";
}
