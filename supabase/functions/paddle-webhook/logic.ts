// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.

export type BillingEnvironment = "sandbox" | "live";

export function isBillingEnvironment(value: unknown): value is BillingEnvironment {
  return value === "sandbox" || value === "live";
}

/**
 * Tolleranza sull'istante firmato. Gli SDK di Paddle usano 5 secondi; qui un
 * margine più largo per gli orologi, perché ripetere un evento già ricevuto non
 * ha effetto (`billing_apply_event` è idempotente per `event_id`).
 */
export const SIGNATURE_TOLERANCE_SECONDS = 30;

/** `Paddle-Signature: ts=1671552777;h1=…[;h1=…]` — più h1 durante la rotazione del segreto. */
export function parseSignature(header: string | null): { ts: number; h1: string[] } | null {
  if (!header) return null;
  let ts: number | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) return null;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "ts") {
      if (ts !== null || !/^\d{1,12}$/.test(value)) return null;
      ts = Number(value);
    } else if (key === "h1") {
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      h1.push(value);
    }
  }
  return ts === null || h1.length === 0 ? null : { ts, h1 };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Confronto a tempo costante: stessa lunghezza garantita dal formato. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Firma calcolata sul corpo **grezzo**, così come è arrivato: un JSON
 * riletto e riserializzato non torna uguale.
 */
export async function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  const parsed = parseSignature(header);
  if (!parsed || !secret) return false;
  if (Math.abs(nowSeconds - parsed.ts) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${parsed.ts}:${rawBody}`);
  let match = false;
  for (const candidate of parsed.h1) match = sameHex(expected, candidate) || match;
  return match;
}

/** Esiti di `billing_apply_event` che Paddle non deve ritentare. */
export const FINAL_OUTCOMES = ["applied", "duplicate", "ignored", "stale", "rejected"] as const;
