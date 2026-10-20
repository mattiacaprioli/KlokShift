import { describe, expect, it, vi } from "vitest";

import { parseRequest, runCleanup, type CleanupFile } from "../../../supabase/functions/workspace-file-cleanup/logic";
import { edgeRuntime, post } from "./runtime";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const file = (id: string, bucketId: CleanupFile["bucketId"], objectName: string): CleanupFile =>
  ({ id, bucketId, objectName, attempts: 0 });

function deps(queue: CleanupFile[], fail: string[] = []) {
  const rows = [...queue];
  return {
    rows,
    listBatch: vi.fn(async (_ws: string, limit: number) => ({ ok: true as const, value: rows.slice(0, limit) })),
    removeObjects: vi.fn(async (bucket: string) => fail.includes(bucket)
      ? { ok: false as const, code: "storage_remove_failed" } : { ok: true as const, value: undefined }),
    markFailed: vi.fn(async () => ({ ok: true as const, value: undefined })),
    clear: vi.fn(async (ids: string[]) => {
      for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1);
      return { ok: true as const, value: undefined };
    }),
  };
}

describe("workspace-file-cleanup: regole pure", () => {
  it("accetta solo un'azienda", () => {
    expect(parseRequest({ workspaceId: WORKSPACE })).toEqual({ workspaceId: WORKSPACE });
    expect(parseRequest({ workspaceId: "x" })).toBeNull();
    expect(parseRequest([])).toBeNull();
  });

  it("toglie i file per bucket e svuota la coda solo dopo la conferma", async () => {
    const d = deps([file("1", "staff-documents", "m/a.pdf"), file("2", "avatars", "u/logo.png"), file("3", "staff-documents", "m/b.pdf")]);
    expect(await runCleanup(WORKSPACE, d)).toEqual({ removed: 3, failed: 0, remaining: false });
    expect(d.removeObjects).toHaveBeenCalledWith("staff-documents", ["m/a.pdf", "m/b.pdf"]);
    expect(d.removeObjects).toHaveBeenCalledWith("avatars", ["u/logo.png"]);
    expect(d.rows).toEqual([]);
  });

  it("uno Storage che rifiuta: le righe restano con il tentativo contato, il giro si ferma", async () => {
    const d = deps([file("1", "staff-documents", "m/a.pdf")], ["staff-documents"]);
    expect(await runCleanup(WORKSPACE, d)).toEqual({ removed: 0, failed: 1, remaining: true, error: "storage_remove_failed" });
    expect(d.markFailed).toHaveBeenCalledOnce();
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.rows).toHaveLength(1);
  });

  it("lavora a lotti finché la coda è vuota", async () => {
    const d = deps(Array.from({ length: 5 }, (_, i) => file(String(i), "staff-documents", `m/${i}.pdf`)));
    expect(await runCleanup(WORKSPACE, d, { batch: 2 })).toEqual({ removed: 5, failed: 0, remaining: false });
    expect(d.listBatch).toHaveBeenCalledTimes(4);
  });
});

describe("workspace-file-cleanup", () => {
  function edge(canAccess: boolean) {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "founder" } }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: { eligible: true, can_access: canAccess }, error: null });
    const select = { eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    select.eq.mockReturnValue(select); select.order.mockReturnValue(select);
    const from = vi.fn(() => ({ select: () => select }));
    const runtime = edgeRuntime("workspace-file-cleanup", {
      "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ auth: { getUser }, rpc, from, storage: { from: vi.fn() } }) },
    });
    return { ...runtime, rpc, from };
  }

  it("senza secondo fattore del fondatore: 403, la coda non si legge", async () => {
    const e = edge(false);
    const response = await e.handle(post({ workspaceId: WORKSPACE }, { Authorization: "Bearer t" }));
    expect(response.status).toBe(403);
    expect(e.from).not.toHaveBeenCalled();
  });

  it("fondatore: verifica col suo token, poi svuota la coda", async () => {
    const e = edge(true);
    const response = await e.handle(post({ workspaceId: WORKSPACE }, { Authorization: "Bearer t" }));
    expect(e.rpc).toHaveBeenCalledWith("get_platform_admin_access");
    expect(await response.json()).toEqual({ removed: 0, failed: 0, remaining: false });
    expect(e.from).toHaveBeenCalledWith("workspace_file_cleanup");
  });

  it("senza token: 401", async () => {
    expect((await edge(true).handle(post({ workspaceId: WORKSPACE }))).status).toBe(401);
  });
});
