import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseWorkspaceAccess } from "@/features/workspace/access";
import { classifications, pageSchema } from "./types";

const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.string().regex(/^[0-9a-f]{32}$/);
const classification = z.enum(classifications);
const access = z.unknown().transform((v, ctx) => {
  try { return parseWorkspaceAccess(v); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid commercial access" }); return z.NEVER; }
});
const lifetime = z.object({
  period_id: id, plan: z.enum(["base", "team"]), venue_limit: count.min(1),
  document_limit_bytes: count.min(1).nullable(),
});
export const snapshotSchema = z.object({
  classification, migration_review_required: z.boolean().nullable(), access: access.nullable(),
  document_known_bytes: count, document_unknown_sizes: count, lifetime: lifetime.nullable(),
});
export const workspaceControlSchema = z.object({
  generated_at: date, target_id: id, revision, snapshot: snapshotSchema,
}).refine((v) => !v.snapshot.access || v.snapshot.access.workspace_id === v.target_id);
export const accountControlSchema = z.object({ generated_at: date, target_id: id, revision, classification });
const action = z.enum(["grant_lifetime", "set_classification", "add_note"]);
export const operationResultSchema = z.object({
  operation_id: id, action, target_id: id, applied_at: date, period_id: id.nullable(),
}).refine((v) => (v.action === "grant_lifetime") === (v.period_id !== null));
const auditState = z.object({
  classification: classification.optional(), access: access.nullable().optional(),
  lifetime: lifetime.nullable().optional(),
});
const operationSchema = z.object({
  operation_id: id, actor_id: id, action, reason: z.string().min(1).max(2000),
  before_state: auditState, after_state: auditState, applied_at: date,
}).refine((v) => v.action === "grant_lifetime" ?
  v.after_state.lifetime != null && v.after_state.access?.state === "operational" &&
    v.after_state.access.source === "complimentary_lifetime" &&
    v.after_state.access.plan === v.after_state.lifetime.plan &&
    v.after_state.access.limits.venues === v.after_state.lifetime.venue_limit :
  v.action !== "set_classification" || (v.before_state.classification !== undefined && v.after_state.classification !== undefined));
export const operationsSchema = pageSchema(operationSchema).and(z.object({ generated_at: date, target_kind: z.enum(["workspace", "account"]), target_id: id }));
export type WorkspaceControl = z.infer<typeof workspaceControlSchema>;
export type AccountControl = z.infer<typeof accountControlSchema>;
export type AdminClassification = typeof classifications[number];
export type WorkspaceAction =
  | { action: "grant_lifetime"; plan: "base" | "team"; venueLimit: number; documentLimitBytes: number }
  | { action: "set_classification"; classification: AdminClassification }
  | { action: "add_note" };
export type WorkspaceCommand = {
  workspaceId: string; operationId: string; revision: string; reason: string; change: WorkspaceAction;
};
export type AccountCommand = {
  accountId: string; operationId: string; revision: string; reason: string; classification: AdminClassification;
};
function parsed<T extends z.ZodType>(schema: T, response: { data: unknown; error: { message: string } | null }): z.output<T> {
  if (response.error) throw new Error(response.error.message);
  const result = schema.safeParse(response.data);
  if (!result.success) throw new Error("admin_response_invalid");
  return result.data;
}
export async function getWorkspaceControl(workspaceId: string) {
  const result = parsed(workspaceControlSchema, await supabase.rpc("admin_get_workspace_control", { p_workspace: workspaceId }));
  if (result.target_id !== workspaceId) throw new Error("admin_response_invalid");
  return result;
}
export async function getAccountControl(accountId: string) {
  const result = parsed(accountControlSchema, await supabase.rpc("admin_get_account_control", { p_account: accountId }));
  if (result.target_id !== accountId) throw new Error("admin_response_invalid");
  return result;
}
export async function applyWorkspaceAction(command: WorkspaceCommand) {
  const c = command.change;
  const result = parsed(operationResultSchema, await supabase.rpc("admin_apply_workspace_action", {
    p_workspace: command.workspaceId, p_action: c.action, p_reason: command.reason,
    p_operation_id: command.operationId, p_expected_revision: command.revision,
    p_plan: c.action === "grant_lifetime" ? c.plan : undefined,
    p_venue_limit: c.action === "grant_lifetime" ? c.venueLimit : undefined,
    p_document_limit_bytes: c.action === "grant_lifetime" ? c.documentLimitBytes : undefined,
    p_classification: c.action === "set_classification" ? c.classification : undefined,
  }));
  if (result.operation_id !== command.operationId || result.target_id !== command.workspaceId || result.action !== c.action)
    throw new Error("admin_response_invalid");
  return result;
}
export async function setAccountClassification(command: AccountCommand) {
  const result = parsed(operationResultSchema, await supabase.rpc("admin_set_account_classification", {
    p_account: command.accountId, p_classification: command.classification, p_reason: command.reason,
    p_operation_id: command.operationId, p_expected_revision: command.revision,
  }));
  if (result.operation_id !== command.operationId || result.target_id !== command.accountId || result.action !== "set_classification")
    throw new Error("admin_response_invalid");
  return result;
}
export async function listOperations(kind: "workspace" | "account", targetId: string, offset: number) {
  const result = parsed(operationsSchema, await supabase.rpc("admin_list_operations", {
    p_target_kind: kind, p_target: targetId, p_offset: offset,
  }));
  if (result.target_kind !== kind || result.target_id !== targetId || result.offset !== offset || result.limit !== 25)
    throw new Error("admin_response_invalid");
  return result;
}
