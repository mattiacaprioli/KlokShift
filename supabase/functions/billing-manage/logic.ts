// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.
// `paddleConfig` è la copia di quello di `billing-checkout` (stesse regole).

export type BillingEnvironment = "sandbox" | "live";
export type ManageAction = "portal" | "resume_renewals" | "preview_change" | "apply_change" | "pause" | "resume" | "cancel"
  | "preview_scheduled_change" | "schedule_change" | "cancel_scheduled_change";
export type ManageRequest = {
  action: ManageAction;
  workspaceId: string;
  plan?: "base" | "team";
  interval?: "month" | "year";
  expectedRenewalCents?: number;
  extraVenues?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly ManageAction[] = ["portal", "resume_renewals", "preview_change", "apply_change", "pause", "resume", "cancel",
  "preview_scheduled_change", "schedule_change", "cancel_scheduled_change"];

/** Il browser sceglie azione e capacità desiderata; tutto il resto lo verifica il database. */
export function parseRequest(body: unknown): ManageRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (!ACTIONS.includes(raw.action as ManageAction)) return null;
  if (typeof raw.workspaceId !== "string" || !UUID.test(raw.workspaceId)) return null;
  const action = raw.action as ManageAction;
  if (action === "preview_change" || action === "apply_change") {
    if (raw.plan !== "base" && raw.plan !== "team") return null;
    if (typeof raw.extraVenues !== "number" || !Number.isSafeInteger(raw.extraVenues) ||
        raw.extraVenues < 0 || raw.extraVenues > 999) return null;
    return { action, workspaceId: raw.workspaceId, plan: raw.plan, extraVenues: raw.extraVenues };
  }
  if (action === "preview_scheduled_change" || action === "schedule_change") {
    if (raw.plan !== "base" && raw.plan !== "team") return null;
    if (raw.interval !== "month" && raw.interval !== "year") return null;
    if (typeof raw.extraVenues !== "number" || !Number.isSafeInteger(raw.extraVenues) ||
        raw.extraVenues < 0 || raw.extraVenues > 999) return null;
    const base: ManageRequest = { action, workspaceId: raw.workspaceId, plan: raw.plan, interval: raw.interval, extraVenues: raw.extraVenues };
    if (action === "preview_scheduled_change") return base;
    // L'importo che il titolare ha visto: se non coincide con quello fresco, non si registra.
    if (typeof raw.expectedRenewalCents !== "number" || !Number.isSafeInteger(raw.expectedRenewalCents) ||
        raw.expectedRenewalCents < 0) return null;
    return { ...base, expectedRenewalCents: raw.expectedRenewalCents };
  }
  return { action, workspaceId: raw.workspaceId };
}

/** Chiave API, token client e ambiente dello stesso account Paddle (vedi `billing-checkout`). */
export function paddleConfig(env: {
  environment?: string; apiKey?: string;
}): { environment: BillingEnvironment; apiKey: string; apiBase: string } | null {
  const { environment, apiKey } = env;
  if (environment === "sandbox" && apiKey?.startsWith("pdl_sdbx_apikey_")) {
    return { environment, apiKey, apiBase: "https://sandbox-api.paddle.com" };
  }
  if (environment === "live" && apiKey?.startsWith("pdl_live_apikey_")) {
    return { environment, apiKey, apiBase: "https://api.paddle.com" };
  }
  return null;
}

/** `raise exception` delle RPC di gestione → stato HTTP e codice per il client. */
const DB_ERRORS: Record<string, number> = {
  not_allowed: 403,
  not_authenticated: 401,
  billing_invalid_selection: 400,
  billing_no_subscription: 404,
  billing_past_due: 409,
  billing_paused: 409,
  billing_change_scheduled: 409,
  billing_downgrade_unsupported: 409,
  billing_no_change: 409,
  billing_price_unavailable: 503,
  billing_not_paused: 409,
  billing_not_needed: 409,
  billing_change_pending: 409,
  billing_scheduled_not_reduction: 409,
  billing_too_close_to_renewal: 409,
  billing_scheduled_people: 409,
  billing_scheduled_venues: 409,
  billing_change_already_sent: 409,
  billing_nothing_scheduled: 409,
};

export function dbError(message: string | undefined): { status: number; code: string } {
  const code = Object.keys(DB_ERRORS).find((key) => message?.includes(key));
  return code ? { status: DB_ERRORS[code], code } : { status: 500, code: "manage_failed" };
}

type Item = { price_id: string; quantity: number };
export type PreparedChange = {
  subscriptionId: string;
  plan: "base" | "team";
  planPriceId: string;
  extraVenues: number;
  extraPriceId: string | null;
  knownPrices: Record<string, "base" | "team" | "extra_venue">;
};

export function parsePreparedChange(data: unknown): PreparedChange | null {
  const raw = data as Record<string, unknown> | null;
  if (!raw || typeof raw.subscription_id !== "string" || !/^sub_[a-z0-9]+$/.test(raw.subscription_id) ||
      (raw.plan !== "base" && raw.plan !== "team") || typeof raw.plan_price_id !== "string" ||
      typeof raw.extra_venues !== "number" || !raw.known_prices || typeof raw.known_prices !== "object") {
    return null;
  }
  return {
    subscriptionId: raw.subscription_id, plan: raw.plan, planPriceId: raw.plan_price_id,
    extraVenues: raw.extra_venues, extraPriceId: typeof raw.extra_price_id === "string" ? raw.extra_price_id : null,
    knownPrices: raw.known_prices as PreparedChange["knownPrices"],
  };
}

/**
 * La lista completa degli articoli dopo il cambio (Paddle sostituisce quella
 * attuale). Gli articoli che non cambiano tengono il loro prezzo: un abbonato
 * non passa a un listino nuovo a metà periodo per effetto di un aumento.
 * `null` se gli articoli attuali non sono riconoscibili: meglio fermarsi.
 */
export function buildItems(current: unknown, change: PreparedChange): Item[] | null {
  if (!Array.isArray(current)) return null;
  let planPrice: string | null = null;
  let currentPlan: string | null = null;
  let extraPrice: string | null = null;
  for (const raw of current) {
    const item = raw as { price?: { id?: unknown }; status?: unknown; recurring?: unknown };
    if (item.status === "inactive" || item.recurring === false) continue;
    const id = item.price?.id;
    if (typeof id !== "string") return null;
    const kind = change.knownPrices[id];
    if (kind === "base" || kind === "team") {
      if (planPrice) return null;
      planPrice = id; currentPlan = kind;
    } else if (kind === "extra_venue") {
      if (extraPrice) return null;
      extraPrice = id;
    } else {
      return null;
    }
  }
  if (!planPrice) return null;
  const items: Item[] = [{ price_id: currentPlan === change.plan ? planPrice : change.planPriceId, quantity: 1 }];
  if (change.extraVenues > 0) {
    const price = extraPrice ?? change.extraPriceId;
    if (!price) return null;
    items.push({ price_id: price, quantity: change.extraVenues });
  }
  return items;
}

export type PreparedScheduledChange = PreparedChange & {
  effectiveAt: string;
  currentInterval: "month" | "year";
  interval: "month" | "year";
};

export function parsePreparedScheduledChange(data: unknown): PreparedScheduledChange | null {
  const base = parsePreparedChange(data);
  const raw = data as Record<string, unknown> | null;
  if (!base || !raw || typeof raw.effective_at !== "string" || !Number.isFinite(Date.parse(raw.effective_at)) ||
      (raw.current_interval !== "month" && raw.current_interval !== "year") ||
      (raw.billing_interval !== "month" && raw.billing_interval !== "year")) return null;
  return { ...base, effectiveAt: raw.effective_at, currentInterval: raw.current_interval, interval: raw.billing_interval };
}

/**
 * Gli articoli del rinnovo programmato. Nello stesso ciclo valgono le regole di
 * `buildItems` (i prezzi invariati restano); cambiando ciclo tutti gli articoli
 * prendono i prezzi d'arrivo. `null` se gli articoli attuali non si riconoscono.
 */
export function buildScheduledItems(current: unknown, change: PreparedScheduledChange): Item[] | null {
  const kept = buildItems(current, change);
  if (!kept || change.interval === change.currentInterval) return kept;
  const items: Item[] = [{ price_id: change.planPriceId, quantity: 1 }];
  if (change.extraVenues > 0) {
    if (!change.extraPriceId) return null;
    items.push({ price_id: change.extraPriceId, quantity: change.extraVenues });
  }
  return items;
}

/** Gli articoli ricorrenti attivi letti da Paddle, nella forma che il database registra. */
export function currentItems(current: unknown): Item[] | null {
  if (!Array.isArray(current)) return null;
  const items: Item[] = [];
  for (const raw of current) {
    const item = raw as { price?: { id?: unknown }; quantity?: unknown; status?: unknown; recurring?: unknown };
    if (item.status === "inactive" || item.recurring === false) continue;
    if (typeof item.price?.id !== "string" || typeof item.quantity !== "number") return null;
    items.push({ price_id: item.price.id, quantity: item.quantity });
  }
  return items.length > 0 ? items : null;
}

/** Il rinnovo letto da Paddle deve coincidere (±120 s) con quello su cui il database ha deciso. */
export function renewalMatches(nextBilledAt: unknown, effectiveAt: string): boolean {
  if (typeof nextBilledAt !== "string") return false;
  const a = Date.parse(nextBilledAt);
  return Number.isFinite(a) && Math.abs(a - Date.parse(effectiveAt)) <= 120_000;
}

/**
 * Pausa e disdetta a fine periodo pagato; ripartenza subito con un periodo
 * nuovo (addebito pieno).
 */
export function lifecycleRequest(action: "pause" | "resume" | "cancel", subscriptionId: string) {
  if (action === "pause") return { path: `/subscriptions/${subscriptionId}/pause`, body: { effective_from: "next_billing_period" } };
  if (action === "cancel") return { path: `/subscriptions/${subscriptionId}/cancel`, body: { effective_from: "next_billing_period" } };
  return { path: `/subscriptions/${subscriptionId}/resume`,
    body: { effective_from: "immediately", on_resume: "start_new_billing_period" } };
}

export function changeBody(items: Item[]) {
  return { items, proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change" };
}

/** Anteprima del rinnovo programmato: niente addebito né accredito adesso. */
export function scheduledPreviewBody(items: Item[]) {
  return { items, proration_billing_mode: "do_not_bill", on_payment_failure: "prevent_change" };
}

const amount = (value: unknown) =>
  typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : null;

/** Importi dell'anteprima in centesimi: da pagare ora e al prossimo rinnovo. */
export function previewSummary(data: unknown) {
  const raw = (data as { data?: Record<string, unknown> } | null)?.data;
  if (!raw) return null;
  const currency = typeof raw.currency_code === "string" ? raw.currency_code : null;
  const now = amount((raw.immediate_transaction as { details?: { totals?: { grand_total?: unknown; total?: unknown } } } | null)
    ?.details?.totals?.grand_total ?? (raw.immediate_transaction as { details?: { totals?: { total?: unknown } } } | null)
    ?.details?.totals?.total);
  const next = amount((raw.recurring_transaction_details as { totals?: { total?: unknown } } | null)?.totals?.total ??
    (raw.next_transaction as { details?: { totals?: { total?: unknown } } } | null)?.details?.totals?.total);
  if (!currency || next === null) return null;
  return { currency, dueNowCents: now ?? 0, renewalCents: next };
}

export type PortalLinks = { overview: string; paymentMethod: string | null; cancel: string | null };

export function portalLinks(data: unknown, subscriptionId: string): PortalLinks | null {
  const urls = (data as { data?: { urls?: { general?: { overview?: unknown }; subscriptions?: unknown } } } | null)
    ?.data?.urls;
  const https = (value: unknown) => typeof value === "string" && value.startsWith("https://") ? value : null;
  const overview = https(urls?.general?.overview);
  if (!overview) return null;
  const sub = Array.isArray(urls?.subscriptions)
    ? (urls.subscriptions as { id?: unknown }[]).find((entry) => entry.id === subscriptionId) as
      { update_subscription_payment_method?: unknown; cancel_subscription?: unknown } | undefined
    : undefined;
  return {
    overview,
    paymentMethod: https(sub?.update_subscription_payment_method),
    cancel: https(sub?.cancel_subscription),
  };
}
