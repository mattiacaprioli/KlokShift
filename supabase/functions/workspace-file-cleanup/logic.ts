// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.

export type BucketId = "avatars" | "staff-documents";
export type CleanupFile = { id: string; bucketId: BucketId; objectName: string; attempts: number };
export type StepResult<T> = { ok: true; value: T } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Il browser sceglie solo l'azienda; i file da togliere li dice la coda. */
export function parseRequest(body: unknown): { workspaceId: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const workspaceId = (body as Record<string, unknown>).workspaceId;
  return typeof workspaceId === "string" && UUID.test(workspaceId) ? { workspaceId } : null;
}

export type CleanupDeps = {
  listBatch(workspaceId: string, limit: number): Promise<StepResult<CleanupFile[]>>;
  removeObjects(bucketId: BucketId, objectNames: string[]): Promise<StepResult<void>>;
  markFailed(files: CleanupFile[], code: string): Promise<StepResult<void>>;
  clear(ids: string[]): Promise<StepResult<void>>;
};

export type CleanupResult = { removed: number; failed: number; remaining: boolean; error?: string };

/**
 * Svuota la coda di un'azienda a lotti. Una riga lascia la coda solo dopo la
 * conferma dello Storage (un oggetto già assente conta come rimosso); un lotto
 * rifiutato resta con il tentativo contato e il giro si ferma, così non si
 * ritenta lo stesso errore all'infinito nella stessa richiesta.
 */
export async function runCleanup(workspaceId: string, deps: CleanupDeps,
  { batch = 100, maxRounds = 20 } = {}): Promise<CleanupResult> {
  let removed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const files = await deps.listBatch(workspaceId, batch);
    if (!files.ok) return { removed, failed: 0, remaining: true, error: files.code };
    if (files.value.length === 0) return { removed, failed: 0, remaining: false };
    const buckets = new Map<BucketId, CleanupFile[]>();
    for (const file of files.value) buckets.set(file.bucketId, [...(buckets.get(file.bucketId) ?? []), file]);
    for (const [bucketId, group] of buckets) {
      const result = await deps.removeObjects(bucketId, group.map((f) => f.objectName));
      if (!result.ok) {
        const marked = await deps.markFailed(group, result.code);
        return { removed, failed: group.length, remaining: true, error: marked.ok ? result.code : marked.code };
      }
      const cleared = await deps.clear(group.map((f) => f.id));
      if (!cleared.ok) return { removed, failed: 0, remaining: true, error: cleared.code };
      removed += group.length;
    }
  }
  return { removed, failed: 0, remaining: true };
}
