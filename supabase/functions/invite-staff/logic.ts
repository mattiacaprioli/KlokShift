/** Un nome interpolato in un'email non può introdurre intestazioni o righe. */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** Errori solo nei log server, senza token, hash o credenziali conosciute. */
export function errorForLog(error: unknown, secrets: readonly string[]): string {
  const details = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown } : null;
  const message = typeof details?.code === "string" ? details.code
    : typeof details?.message === "string" ? details.message : String(error);
  return secrets.filter(Boolean).reduce(
    (text, secret) => text.replaceAll(secret, "[redatto]"), message
  );
}
