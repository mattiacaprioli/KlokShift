/**
 * Riassunto dell'abbonamento per il titolare (`get_workspace_billing`): stato e
 * date, mai identificativi Paddle. L'unico importo è quello del cambio
 * programmato al rinnovo, già visto e confermato dal titolare: lo legge solo la
 * pagina Piano sul web (l'app nativa non mostra prezzi). Il diritto resta quello
 * di `access.ts`; questo serve solo a spiegare rinnovi, disdette e pagamenti.
 * Non importa Expo/React Native.
 */
const STATUSES = ["active", "past_due", "paused", "canceled"] as const;
const PLANS = ["base", "team"] as const;
const INTERVALS = ["month", "year"] as const;
const ACTIONS = ["cancel", "pause", "resume"] as const;
const PENDING_STATUSES = ["pending", "applied"] as const;

/**
 * Il cambio programmato al rinnovo, ancora aperto: `pending` si annulla fino a
 * `cancel_until` (24 ore prima del rinnovo), `applied` è già stato inviato a
 * Paddle. L'importo è quello che il titolare ha visto e confermato.
 */
export type PendingPlanChange = {
  plan: (typeof PLANS)[number];
  billing_interval: (typeof INTERVALS)[number];
  extra_venues: number;
  effective_at: string;
  renewal_cents: number;
  currency: string;
  status: (typeof PENDING_STATUSES)[number];
  cancel_until: string;
};

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
  pending_change: PendingPlanChange | null;
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

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}

function required(value: unknown): string {
  return instant(value) ?? invalid();
}

function pendingChange(value: unknown): PendingPlanChange | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const c = value as Record<string, unknown>;
  return {
    plan: oneOf(c.plan, PLANS),
    billing_interval: oneOf(c.billing_interval, INTERVALS),
    extra_venues: count(c.extra_venues),
    effective_at: required(c.effective_at),
    renewal_cents: count(c.renewal_cents),
    currency: typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency) ? c.currency : invalid(),
    status: oneOf(c.status, PENDING_STATUSES),
    cancel_until: required(c.cancel_until),
  };
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
    extra_venues: count(raw.extra_venues),
    current_period_ends_at: instant(raw.current_period_ends_at),
    scheduled_change: change === null || change === undefined ? null : (() => {
      const c = change as Record<string, unknown>;
      const at = instant(c.effective_at);
      return at ? { action: oneOf(c.action, ACTIONS), effective_at: at } : invalid();
    })(),
    past_due_since: instant(raw.past_due_since),
    canceled_at: instant(raw.canceled_at),
    paused_at: instant(raw.paused_at),
    pending_change: pendingChange(raw.pending_change),
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
