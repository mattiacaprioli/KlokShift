import { describe, expect, it } from "vitest";

import {
  runDeleteAccount,
  type DeleteAccountDeps,
  type FileRef,
  type QueuedFile,
  type StepResult,
} from "../../../supabase/functions/delete-account/logic";

const ok = <T>(value: T): StepResult<T> => ({ ok: true, value });
const fail = <T>(code: string): StepResult<T> => ({ ok: false, code });

function fixture(avatarCount = 0) {
  const avatars = Array.from({ length: avatarCount }, (_, i) => `${i}.jpg`);
  const queue = new Map<string, QueuedFile>();
  const removed: FileRef[] = [];
  let sequence = 0;
  let failAvatarPage = -1;
  let failData = false;
  let removeFailures = 0;
  let authFailures = 0;

  const calls = {
    avatarOffsets: [] as number[],
    deleteData: 0,
    deleteAuth: 0,
    markFailed: 0,
  };

  const deps: DeleteAccountDeps = {
    async listAvatarPage(_userId, offset, limit) {
      calls.avatarOffsets.push(offset);
      if (offset === failAvatarPage) return fail("list_failed");
      return ok(avatars.slice(offset, offset + limit));
    },
    async enqueueFiles(userId, files) {
      for (const file of files) {
        const key = `${userId}:${file.bucketId}:${file.objectName}`;
        if (!queue.has(key)) {
          sequence += 1;
          queue.set(key, { ...file, id: `queued-${sequence}`, attempts: 0 });
        }
      }
      return ok(undefined);
    },
    async deleteAccountData(userId) {
      calls.deleteData += 1;
      if (failData) return fail("document_enumeration_failed");
      // Simula l'INSERT atomico della RPC prima della DELETE dei documenti.
      await deps.enqueueFiles(userId, [
        { bucketId: "staff-documents", objectName: "member/document.pdf" },
      ]);
      return ok(undefined);
    },
    async listCleanupBatch(_userId, limit) {
      return ok([...queue.values()].slice(0, limit));
    },
    async removeObjects(bucketId, objectNames) {
      if (removeFailures > 0) {
        removeFailures -= 1;
        return fail("remove_failed");
      }
      removed.push(...objectNames.map((objectName) => ({ bucketId, objectName })));
      return ok(undefined);
    },
    async markCleanupFailed() {
      calls.markFailed += 1;
      return ok(undefined);
    },
    async clearCleanup(ids) {
      const wanted = new Set(ids);
      for (const [key, file] of queue) {
        if (wanted.has(file.id)) queue.delete(key);
      }
      return ok(undefined);
    },
    async deleteAuthUser() {
      calls.deleteAuth += 1;
      if (authFailures > 0) {
        authFailures -= 1;
        return fail("auth_failed");
      }
      return ok(undefined);
    },
  };

  return {
    deps,
    calls,
    queue,
    removed,
    failAvatarAt(offset: number) {
      failAvatarPage = offset;
    },
    failDocumentEnumeration() {
      failData = true;
    },
    failStorage(times = 1) {
      removeFailures = times;
    },
    failAuth(times = 1) {
      authFailures = times;
    },
  };
}

describe("delete-account Edge", () => {
  it("non muta i dati se il censimento avatar fallisce", async () => {
    const f = fixture(150);
    f.failAvatarAt(100);

    await expect(runDeleteAccount("user", f.deps)).resolves.toEqual({
      deleted: false,
      retryable: true,
      error: "avatar_enumeration_failed",
    });
    expect(f.calls.deleteData).toBe(0);
    expect(f.calls.deleteAuth).toBe(0);
  });

  it("non perde riferimenti se il censimento documenti nella RPC fallisce", async () => {
    const f = fixture(1);
    f.failDocumentEnumeration();

    const result = await runDeleteAccount("user", f.deps);

    expect(result).toMatchObject({ deleted: false, retryable: true });
    expect(f.queue.size).toBe(1); // l'avatar già censito resta ritentabile
    expect(f.calls.deleteAuth).toBe(0);
  });

  it("pagina tutti gli avatar e pulisce avatar e documenti prima di Auth", async () => {
    const f = fixture(205);

    await expect(runDeleteAccount("user", f.deps)).resolves.toEqual({
      deleted: true,
      retryable: false,
    });
    expect(f.calls.avatarOffsets).toEqual([0, 100, 200]);
    expect(f.removed).toHaveLength(206);
    expect(f.queue.size).toBe(0);
    expect(f.calls.deleteAuth).toBe(1);
  });

  it("conserva la coda su errore Storage e il retry dopo la RPC è innocuo", async () => {
    const f = fixture(2);
    f.failStorage();

    const first = await runDeleteAccount("user", f.deps);
    expect(first).toEqual({
      deleted: false,
      retryable: true,
      error: "storage_cleanup_pending",
    });
    expect(f.queue.size).toBe(3);
    expect(f.calls.markFailed).toBe(1);
    expect(f.calls.deleteAuth).toBe(0);

    const second = await runDeleteAccount("user", f.deps);
    expect(second).toEqual({ deleted: true, retryable: false });
    expect(f.calls.deleteData).toBe(2);
    expect(f.queue.size).toBe(0);
    expect(f.calls.deleteAuth).toBe(1);
  });

  it("può ritentare anche se la cancellazione Auth fallisce dopo il cleanup", async () => {
    const f = fixture();
    f.failAuth();

    expect(await runDeleteAccount("user", f.deps)).toMatchObject({
      deleted: false,
      retryable: true,
      error: "auth_deletion_failed",
    });
    expect(f.queue.size).toBe(0);

    expect(await runDeleteAccount("user", f.deps)).toEqual({
      deleted: true,
      retryable: false,
    });
    expect(f.calls.deleteAuth).toBe(2);
  });
});
