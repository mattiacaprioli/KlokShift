import { UserFacingError } from "@/lib/errors";

/** Solo una risposta persa in rete permette di ripetere lo stesso comando. */
export function confirmationFailure(error: unknown): { retry: boolean; error: unknown } {
  const message = error instanceof Error ? error.message : "";
  if (/admin_stale_revision|admin_operation_conflict/.test(message)) {
    return { retry: false, error: new UserFacingError("Aggiorna e prepara una nuova conferma.") };
  }
  const retry = /failed to fetch|fetch failed|network request failed|network error|networkerror|load failed|timed? ?out/i.test(message);
  return { retry, error };
}
