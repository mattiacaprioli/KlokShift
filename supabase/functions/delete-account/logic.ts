export type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

export type FileRef = {
  bucketId: "avatars" | "staff-documents";
  objectName: string;
};

export type QueuedFile = FileRef & { id: string; attempts: number };

export type DeleteAccountDeps = {
  listAvatarPage: (
    userId: string,
    offset: number,
    limit: number
  ) => Promise<StepResult<string[]>>;
  enqueueFiles: (
    userId: string,
    files: FileRef[]
  ) => Promise<StepResult<undefined>>;
  deleteAccountData: (userId: string) => Promise<StepResult<undefined>>;
  listCleanupBatch: (
    userId: string,
    limit: number
  ) => Promise<StepResult<QueuedFile[]>>;
  removeObjects: (
    bucketId: FileRef["bucketId"],
    objectNames: string[]
  ) => Promise<StepResult<undefined>>;
  markCleanupFailed: (
    files: QueuedFile[],
    code: string
  ) => Promise<StepResult<undefined>>;
  clearCleanup: (ids: string[]) => Promise<StepResult<undefined>>;
  deleteAuthUser: (userId: string) => Promise<StepResult<undefined>>;
};

export type DeleteAccountResult =
  | { deleted: true; retryable: false }
  | { deleted: false; retryable: true; error: string };

const AVATAR_PAGE_SIZE = 100;
const CLEANUP_BATCH_SIZE = 100;

function retry(error: string): DeleteAccountResult {
  return { deleted: false, retryable: true, error };
}

/**
 * Cancellazione ritentabile, indipendente dal runtime Edge per poter simulare
 * ogni failure senza account o bucket reali.
 *
 * L'identità Auth viene eliminata soltanto quando la coda è vuota. Finché un
 * blob non è confermato rimosso l'utente può quindi richiamare lo stesso
 * endpoint: `delete_account` e gli upsert della coda sono idempotenti.
 */
export async function runDeleteAccount(
  userId: string,
  deps: DeleteAccountDeps
): Promise<DeleteAccountResult> {
  try {
    const avatars: FileRef[] = [];
    for (let offset = 0; ; offset += AVATAR_PAGE_SIZE) {
      const page = await deps.listAvatarPage(
        userId,
        offset,
        AVATAR_PAGE_SIZE
      );
      if (!page.ok) return retry("avatar_enumeration_failed");
      avatars.push(
        ...page.value.map((name) => ({
          bucketId: "avatars" as const,
          objectName: `${userId}/${name}`,
        }))
      );
      if (page.value.length < AVATAR_PAGE_SIZE) break;
    }

    if (avatars.length > 0) {
      const queued = await deps.enqueueFiles(userId, avatars);
      if (!queued.ok) return retry("cleanup_queue_failed");
    }

    // La RPC accoda atomicamente i documenti prima di eliminarne le righe.
    const deletedData = await deps.deleteAccountData(userId);
    if (!deletedData.ok) return retry("account_data_cleanup_failed");

    while (true) {
      const pending = await deps.listCleanupBatch(
        userId,
        CLEANUP_BATCH_SIZE
      );
      if (!pending.ok) return retry("cleanup_queue_read_failed");
      if (pending.value.length === 0) break;

      const byBucket = new Map<FileRef["bucketId"], QueuedFile[]>();
      for (const file of pending.value) {
        const group = byBucket.get(file.bucketId) ?? [];
        group.push(file);
        byBucket.set(file.bucketId, group);
      }

      for (const [bucketId, files] of byBucket) {
        const removed = await deps.removeObjects(
          bucketId,
          files.map((file) => file.objectName)
        );
        if (!removed.ok) {
          // Best-effort: anche se il contatore non si aggiorna, le righe della
          // coda restano e il retry non perde i path.
          await deps.markCleanupFailed(
            files,
            "storage_remove_failed"
          );
          return retry("storage_cleanup_pending");
        }
        const cleared = await deps.clearCleanup(files.map((file) => file.id));
        if (!cleared.ok) return retry("cleanup_queue_clear_failed");
      }
    }

    const deletedAuth = await deps.deleteAuthUser(userId);
    if (!deletedAuth.ok) return retry("auth_deletion_failed");
    return { deleted: true, retryable: false };
  } catch {
    // Nessun dettaglio del provider, token o path finisce nella risposta.
    return retry("unexpected_cleanup_failure");
  }
}
