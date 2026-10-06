import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyWorkspaceAction, getWorkspaceControl, getAccountControl, setAccountClassification, listOperations } from "@/features/admin/controls";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const op = "33333333-3333-4333-8333-333333333333";
const revision = "0".repeat(32);
const date = "2026-10-06T12:00:00+00:00";
const result = { operation_id: op, target_id: id, action: "grant_lifetime", applied_at: date, period_id: other };
function response(data: unknown) { rpc.mockResolvedValue({ data, error: null }); }
const command = { workspaceId: id, operationId: op, revision, reason: "Fixture scelta", change: { action: "grant_lifetime" as const, plan: "base" as const, venueLimit: 2, documentLimitBytes: 2147483648 } };
describe("Interventi del fondatore: esito verificato e retry", () => {
  beforeEach(() => rpc.mockReset());
  it("trasmette capacità e identità dell'intervento senza inventare date o periodi pagati", async () => {
    response(result);
    await expect(applyWorkspaceAction(command)).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledWith("admin_apply_workspace_action", {
      p_workspace: id, p_action: "grant_lifetime", p_reason: command.reason, p_operation_id: op,
      p_expected_revision: revision, p_plan: "base", p_venue_limit: 2, p_document_limit_bytes: 2147483648,
      p_classification: undefined,
    });
  });
  it("ripete lo stesso identificativo dopo un errore senza duplicare la richiesta", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network error" } }).mockResolvedValueOnce({ data: result, error: null });
    await expect(applyWorkspaceAction(command)).rejects.toThrow("network error");
    await applyWorkspaceAction(command);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
  it("rifiuta esiti di un altro destinatario, operazione o tipo", async () => {
    for (const invalid of [{ ...result, target_id: other }, { ...result, operation_id: other },
      { ...result, action: "add_note" }, { ...result, period_id: null }]) {
      response(invalid);
      await expect(applyWorkspaceAction(command)).rejects.toThrow("admin_response_invalid");
    }
  });
  it("mantiene distinti classificazione e concessione", async () => {
    response({ ...result, action: "set_classification", period_id: null });
    await applyWorkspaceAction({ ...command, change: { action: "set_classification", classification: "test" } });
    const args = rpc.mock.calls[0][1];
    expect(args.p_plan).toBeUndefined();
    expect(args.p_document_limit_bytes).toBeUndefined();
    expect(args.p_classification).toBe("test");
  });
  it("propaga capacità, conflitti e revoca del server", async () => {
    for (const message of ["workspace_people_capacity", "admin_stale_revision", "admin_not_allowed"]) {
      rpc.mockResolvedValue({ data: null, error: { message } });
      await expect(applyWorkspaceAction(command)).rejects.toThrow(message);
    }
  });
  it("rifiuta controllo con revisione mancante o appartenente a un altro account", async () => {
    response({ generated_at: date, target_id: other, revision, classification: "test" });
    await expect(getAccountControl(id)).rejects.toThrow("admin_response_invalid");
    response({ generated_at: date, target_id: id, classification: "test" });
    await expect(getAccountControl(id)).rejects.toThrow("admin_response_invalid");
    response({ generated_at: date, target_id: id, revision, snapshot: {
      classification: "unclassified", migration_review_required: true, access: null,
      document_known_bytes: 0, document_unknown_sizes: 0, lifetime: null,
    } });
    await expect(getWorkspaceControl(id)).resolves.toMatchObject({ revision });
  });
  it("verifica il destinatario della classificazione account", async () => {
    response({ ...result, target_id: other, action: "set_classification", period_id: null });
    await expect(setAccountClassification({ accountId: id, operationId: op, revision, reason: "Test", classification: "test" })).rejects.toThrow("admin_response_invalid");
  });
  it("verifica pagina e destinatario del registro", async () => {
    const page = { generated_at: date, total: 0, limit: 25, offset: 0, items: [], target_kind: "workspace", target_id: id };
    response(page);
    await expect(listOperations("workspace", id, 0)).resolves.toEqual(page);
    for (const invalid of [{ ...page, target_id: other }, { ...page, offset: 25 }, { ...page, target_kind: "account" }]) {
      response(invalid);
      await expect(listOperations("workspace", id, 0)).rejects.toThrow("admin_response_invalid");
    }
  });
  it("non presenta una concessione nel registro se capacità o accesso mancano", async () => {
    response({ generated_at: date, total: 1, limit: 25, offset: 0, target_kind: "workspace", target_id: id,
      items: [{ operation_id: op, actor_id: id, action: "grant_lifetime", reason: "Fixture",
        applied_at: date, before_state: {}, after_state: {} }] });
    await expect(listOperations("workspace", id, 0)).rejects.toThrow("admin_response_invalid");
  });
});
