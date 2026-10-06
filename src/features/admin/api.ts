import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { adminAccessSchema, overviewSchema, workspaceListSchema, workspaceDetailSchema, accountListSchema, accountDetailSchema } from "./types";
import type { WorkspaceFilters, AccountFilters } from "./types";
function parsed<T extends z.ZodType>(schema: T, result: {
  data: unknown;
  error: {
    message: string;
  } | null;
}): z.output<T> {
  if (result.error)
    throw new Error(result.error.message);
  const value = schema.safeParse(result.data);
  if (!value.success)
    throw new Error("admin_response_invalid");
  return value.data;
}
export async function getAdminAccess() { return parsed(adminAccessSchema, await supabase.rpc("get_platform_admin_access")); }
export async function getAdminOverview() { return parsed(overviewSchema, await supabase.rpc("admin_get_overview")); }
export async function listAdminWorkspaces(f: WorkspaceFilters) {
  const result = parsed(workspaceListSchema, await supabase.rpc("admin_list_workspaces", { p_query: f.query, p_state: f.state, p_plan: f.plan, p_classification: f.classification, p_limit: 25, p_offset: f.offset }));
  if (result.offset !== f.offset || result.limit !== 25)
    throw new Error("admin_response_invalid");
  return result;
}
export async function getAdminWorkspace(id: string, offsets: {
  members: number;
  venues: number;
  periods: number;
}) {
  const result = parsed(workspaceDetailSchema, await supabase.rpc("admin_get_workspace", { p_workspace: id, p_members_offset: offsets.members, p_venues_offset: offsets.venues, p_periods_offset: offsets.periods }));
  if (result.workspace.id !== id || result.members.offset !== offsets.members || result.venues.offset !== offsets.venues || result.periods.offset !== offsets.periods)
    throw new Error("admin_response_invalid");
  return result;
}
export async function listAdminAccounts(f: AccountFilters) {
  const result = parsed(accountListSchema, await supabase.rpc("admin_list_accounts", { p_query: f.query, p_status: f.status, p_classification: f.classification, p_limit: 25, p_offset: f.offset }));
  if (result.offset !== f.offset || result.limit !== 25)
    throw new Error("admin_response_invalid");
  return result;
}
export async function getAdminAccount(id: string, offset: number) {
  const result = parsed(accountDetailSchema, await supabase.rpc("admin_get_account", { p_account: id, p_offset: offset }));
  if (result.account.id !== id || result.memberships.offset !== offset)
    throw new Error("admin_response_invalid");
  return result;
}
export async function listAdminMfaFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error)
    throw new Error(error.message);
  const describe = (f: typeof data.all[number]) => ({ id: f.id, name: f.friendly_name ?? "App di autenticazione" });
  return {
    verified: data.totp.filter((f) => f.status === "verified").map(describe),
    pending: data.all.filter((f) => f.factor_type === "totp" && f.status === "unverified").map(describe),
  };
}
export async function enrollAdminMfa() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `KlokShift ${new Date().toISOString()}` });
  if (error)
    throw new Error(error.message);
  // Il segreto resta nel form, mai in React Query, storage o log.
  // auth-js aggiunge il prefisso ma lascia l'SVG grezzo: un colore #000
  // diventerebbe il fragment dell'URL e troncherebbe l'immagine nel browser.
  const prefix = "data:image/svg+xml;utf-8,";
  if (!data.totp.qr_code.startsWith(prefix)) throw new Error("admin_response_invalid");
  const qr = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code.slice(prefix.length))}`;
  return { id: data.id, qr, secret: data.totp.secret };
}
export async function cancelAdminMfaEnrollment(id: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
  if (error)
    throw new Error(error.message);
}
export async function verifyAdminMfa(id: string, code: string) {
  if (!/^\d{6}$/.test(code))
    throw new Error("admin_mfa_verification_failed");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code });
  if (error)
    throw new Error("admin_mfa_verification_failed");
}
