import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceAccess, startWorkspaceTrial } from "@/features/workspace/api";
import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const periodId = "33333333-3333-4333-8333-333333333333";
const setup = {
  workspace_id: workspaceId,
  state: "setup",
  source: null,
  plan: null,
  operational_from: null,
  operational_until: null,
  archive_until: null,
  attendance_until: null,
  can_operate: false,
  can_read: true,
  can_complete_attendance: false,
  limits: { people: null, venues: null },
  usage: { people: 0, venues: 0 },
  server_now: null,
  next_change_at: null,
};

describe("API commerciale per azienda", () => {
  beforeEach(() => rpc.mockReset());

  it("richiede al server lo stato dell'azienda specifica", async () => {
    rpc.mockResolvedValue({ data: setup, error: null });
    await expect(getWorkspaceAccess(workspaceId)).resolves.toEqual(setup);
    expect(rpc).toHaveBeenCalledWith("get_workspace_access", {
      p_workspace: workspaceId,
    });
  });

  it("rifiuta una risposta valida ma appartenente a un'altra azienda", async () => {
    rpc.mockResolvedValue({
      data: { ...setup, workspace_id: otherWorkspaceId },
      error: null,
    });
    await expect(getWorkspaceAccess(workspaceId)).rejects.toThrow(
      "workspace_access_invalid"
    );
  });

  it("non interpreta dati mancanti come accesso operativo", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getWorkspaceAccess(workspaceId)).rejects.toThrow(
      "workspace_access_invalid"
    );
  });

  it("propaga il rifiuto di autorizzazione del server", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_allowed" } });
    await expect(getWorkspaceAccess(workspaceId)).rejects.toThrow("not_allowed");
  });

  it("avvia la prova senza accettare date o capacità dal client", async () => {
    rpc.mockResolvedValue({ data: periodId, error: null });
    await expect(startWorkspaceTrial(workspaceId)).resolves.toBe(periodId);
    expect(rpc).toHaveBeenCalledWith("start_workspace_trial", {
      p_workspace: workspaceId,
    });
  });

  it("non dichiara avviata una prova senza identificativo di periodo", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(startWorkspaceTrial(workspaceId)).rejects.toThrow();
  });

  it("mantiene separati gli stati nella cache di due aziende", () => {
    const client = createTestQueryClient();
    const key = qk.workspaceAccess.byWorkspace(workspaceId);
    const otherKey = qk.workspaceAccess.byWorkspace(otherWorkspaceId);
    client.setQueryData(key, setup);
    client.setQueryData(otherKey, { ...setup, workspace_id: otherWorkspaceId });
    expect(client.getQueryData(key)).toEqual(setup);
    expect(client.getQueryData(otherKey)).toEqual({
      ...setup,
      workspace_id: otherWorkspaceId,
    });
    client.clear();
  });
});
