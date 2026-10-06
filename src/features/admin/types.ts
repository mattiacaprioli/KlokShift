import { z } from "zod";
import { parseWorkspaceAccess } from "@/features/workspace/access";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const maybeDate = date.nullable();
export const classifications = ["customer", "internal", "test", "unclassified"] as const;
export const workspaceStates = ["setup", "operational", "archive", "expired", "migration_pending", "unavailable", "deleted"] as const;
export const accountStates = ["confirmed", "unconfirmed", "anonymous", "deleted"] as const;
const authority = z.enum(["owner", "collaborator", "none"]);
const memberStatus = z.enum(["active", "invited", "left"]);
const scope = z.enum(["all", "selected"]);
const flag = z.object({ code: z.enum(["migration_pending", "commercial_data_missing", "trial_ending", "archive_ending", "attendance_window", "archive_expired", "people_near_capacity", "people_over_capacity", "venues_over_capacity", "document_measurement_incomplete"]), severity: z.enum(["critical", "warning", "info"]), at: maybeDate, source: z.string() });
export const adminAccessSchema = z.object({ eligible: z.boolean(), can_access: z.boolean() }).refine((v) => !v.can_access || v.eligible);
const access = z.unknown().transform((v, ctx) => {
  try {
    return parseWorkspaceAccess(v);
  }
  catch {
    ctx.addIssue({ code: "custom", message: "Invalid commercial access" });
    return z.NEVER;
  }
});
export const workspaceSchema = z.object({
  id, name: z.string(), created_at: date, deleted_at: maybeDate,
  classification: z.enum(classifications), state: z.enum(workspaceStates), access: access.nullable(),
  open_venues: count, closed_venues: count, active_members: count, invited_members: count, left_members: count,
  unlinked_members: count, managers: count, current_placements: count,
  document_files: count, document_known_bytes: count, document_unknown_sizes: count, flags: z.array(flag),
}).refine((v) => v.access === null ? ["deleted", "unavailable"].includes(v.state) :
  v.access.workspace_id === v.id && v.access.state === v.state && v.access.usage !== null);
export const accountSchema = z.object({
  id, full_name: z.string().nullable(), email: z.string().nullable(), created_at: maybeDate,
  email_confirmed_at: maybeDate, last_sign_in_at: maybeDate, deleted_at: maybeDate, is_anonymous: z.boolean(),
  status: z.enum(accountStates), classification: z.enum(classifications),
  active_memberships: count, invited_memberships: count, left_memberships: count,
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ total: count, limit: count.min(1).max(50), offset: count.max(100000), items: z.array(item) })
    .refine((v) => v.items.length <= v.limit && v.items.length <= Math.max(0, v.total - v.offset));
}
export const workspaceListSchema = pageSchema(workspaceSchema).and(z.object({ generated_at: date }));
export const accountListSchema = pageSchema(accountSchema).and(z.object({ generated_at: date }));
export const overviewSchema = z.object({
  generated_at: date,
  workspaces: z.object({ total: count, states: z.partialRecord(z.enum(workspaceStates), count), classifications: z.partialRecord(z.enum(classifications), count), operational_sources: z.record(z.string(), count) }),
  accounts: z.object({ total: count, confirmed: count, unconfirmed: count, anonymous: count, deleted_available: count }),
  usage: z.object({ open_venues: count, closed_venues: count, active_members: count, invited_members: count, left_members: count, unlinked_members: count, managers: count, current_placements: count, commercial_people: count }),
  documents: z.object({ files: count, known_bytes: count, unknown_sizes: count, unattributed_files: count }),
  signals: z.array(flag.extend({ workspace_id: id, workspace_name: z.string() })).max(20), finance: z.null(), costs: z.null(),
});
const member = z.object({ id, user_id: id.nullable(), display_name: z.string(), authority, status: memberStatus, email: z.string().nullable(), email_confirmed_at: maybeDate, scope, counts_as_person: z.boolean() });
const venue = z.object({ id, name: z.string(), created_at: date, closed_at: maybeDate, current_placements: count });
const period = z.object({ id, kind: z.enum(["trial", "complimentary_lifetime", "complimentary_temporary", "transition"]), plan: z.enum(["base", "team"]), venue_limit: count.min(1), starts_at: date, ends_at: maybeDate, revoked_at: maybeDate, reason: z.string(), created_at: date });
export const workspaceDetailSchema = z.object({
  generated_at: date, workspace: workspaceSchema,
  members: pageSchema(member), venues: pageSchema(venue), periods: pageSchema(period),
  activity: z.object({ last_shift_created_at: maybeDate, last_clock_in_at: maybeDate, last_manager_sign_in_at: maybeDate }),
  classification_reason: z.string().nullable(), finance: z.null(), costs: z.null(),
});
const membership = z.object({
  id, workspace_id: id, workspace_name: z.string(), workspace_deleted_at: maybeDate,
  display_name: z.string(), authority, status: memberStatus, scope, managed_venues_total: count,
  managed_venues: z.array(z.object({ id, name: z.string(), closed_at: maybeDate })).max(25),
  works_total: count, works: z.array(z.object({ venue_id: id, venue_name: z.string(), left_at: maybeDate, closed_at: maybeDate })).max(25),
});
export const accountDetailSchema = z.object({ generated_at: date, account: accountSchema, memberships: pageSchema(membership), classification_reason: z.string().nullable() });
export type AdminWorkspace = z.infer<typeof workspaceSchema>;
export type AdminFlag = z.infer<typeof flag>;
export type AdminAccount = z.infer<typeof accountSchema>;
export type AdminPage = {
  total: number;
  limit: number;
  offset: number;
};
export type WorkspaceFilters = {
  query: string;
  state: "all" | typeof workspaceStates[number];
  plan: "all" | "base" | "team";
  classification: "all" | typeof classifications[number];
  offset: number;
};
export type AccountFilters = {
  query: string;
  status: "all" | typeof accountStates[number];
  classification: "all" | typeof classifications[number];
  offset: number;
};
