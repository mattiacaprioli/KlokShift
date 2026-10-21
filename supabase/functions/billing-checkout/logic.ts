// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.

export type BillingEnvironment = "sandbox" | "live";
export type CheckoutSelection = {
  workspaceId: string;
  plan: "base" | "team";
  interval: "month" | "year";
  extraVenues: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Richiesta della configurazione pubblica di Paddle.js (ambiente e token client). */
export function isClientConfigRequest(body: unknown): boolean {
  return !!body && typeof body === "object" && !Array.isArray(body) &&
    (body as Record<string, unknown>).action === "client_config" && Object.keys(body).length === 1;
}

/** Il browser sceglie solo cosa comprare: prezzi e azienda li verifica il database. */
export function parseSelection(body: unknown): CheckoutSelection | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.workspaceId !== "string" || !UUID.test(raw.workspaceId)) return null;
  if (raw.plan !== "base" && raw.plan !== "team") return null;
  if (raw.interval !== "month" && raw.interval !== "year") return null;
  if (typeof raw.extraVenues !== "number" || !Number.isSafeInteger(raw.extraVenues) ||
      raw.extraVenues < 0 || raw.extraVenues > 999) return null;
  return { workspaceId: raw.workspaceId, plan: raw.plan, interval: raw.interval, extraVenues: raw.extraVenues };
}

/**
 * Chiave API, token client e ambiente devono essere dello stesso account Paddle:
 * una chiave live con l'ambiente sandbox addebiterebbe davvero mentre si prova.
 */
export function paddleConfig(env: {
  environment?: string; apiKey?: string; clientToken?: string;
}): { environment: BillingEnvironment; apiKey: string; clientToken: string; apiBase: string } | null {
  const { environment, apiKey, clientToken } = env;
  if (environment === "sandbox") {
    if (!apiKey?.startsWith("pdl_sdbx_apikey_") || !clientToken?.startsWith("test_")) return null;
    return { environment, apiKey, clientToken, apiBase: "https://sandbox-api.paddle.com" };
  }
  if (environment === "live") {
    if (!apiKey?.startsWith("pdl_live_apikey_") || !clientToken?.startsWith("live_")) return null;
    return { environment, apiKey, clientToken, apiBase: "https://api.paddle.com" };
  }
  return null;
}

/** `raise exception` di billing_prepare_checkout → stato HTTP e codice per il client. */
const PREPARE_ERRORS: Record<string, number> = {
  not_allowed: 403,
  not_authenticated: 401,
  billing_invalid_selection: 400,
  billing_subscription_exists: 409,
  billing_not_required: 409,
  workspace_people_capacity: 409,
  workspace_venue_capacity: 409,
  workspace_access_unavailable: 409,
  billing_checkout_rate_limited: 429,
  billing_price_unavailable: 503,
};

export function prepareError(message: string | undefined): { status: number; code: string } {
  const code = Object.keys(PREPARE_ERRORS).find((key) => message?.includes(key));
  return code ? { status: PREPARE_ERRORS[code], code } : { status: 500, code: "prepare_failed" };
}

export type PreparedCheckout = { checkoutId: string; items: { price_id: string; quantity: number }[] };

export function parsePrepared(data: unknown): PreparedCheckout | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as { checkout_id?: unknown; items?: unknown };
  if (typeof raw.checkout_id !== "string" || !UUID.test(raw.checkout_id) || !Array.isArray(raw.items) ||
      raw.items.length === 0) return null;
  const items = raw.items.map((item) => {
    const value = item as { price_id?: unknown; quantity?: unknown };
    return typeof value.price_id === "string" && /^pri_[a-z0-9]+$/.test(value.price_id) &&
      typeof value.quantity === "number" && Number.isSafeInteger(value.quantity) && value.quantity >= 1
      ? { price_id: value.price_id, quantity: value.quantity } : null;
  });
  return items.every((item) => item !== null)
    ? { checkoutId: raw.checkout_id, items: items as PreparedCheckout["items"] } : null;
}

/** Corpo della transazione Paddle: l'azienda passa solo dal riferimento della richiesta. */
export function transactionBody(prepared: PreparedCheckout) {
  return {
    items: prepared.items,
    collection_mode: "automatic",
    custom_data: { klokshift_checkout: prepared.checkoutId },
  };
}

export function transactionId(data: unknown): string | null {
  const id = (data as { data?: { id?: unknown } } | null)?.data?.id;
  return typeof id === "string" && /^txn_[a-z0-9]+$/.test(id) ? id : null;
}
