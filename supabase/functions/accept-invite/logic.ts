// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** 100 caratteri Unicode: non troncare a metà una coppia di surrogate. */
export function fullName(value: string): string {
  return Array.from(oneLine(value)).slice(0, 100).join("");
}

/** Stesse classi ASCII del client, più il limite UTF-8 di GoTrue. */
export function isPasswordValid(value: string): boolean {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
    /[0-9]/.test(value) && new TextEncoder().encode(value).length <= 72;
}

export function errorForLog(error: unknown, secrets: readonly string[]): string {
  const details = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown } : null;
  const message = typeof details?.code === "string" ? details.code
    : typeof details?.message === "string" ? details.message : String(error);
  return secrets.filter(Boolean).reduce(
    (text, secret) => text.replaceAll(secret, "[redatto]"), message
  );
}
