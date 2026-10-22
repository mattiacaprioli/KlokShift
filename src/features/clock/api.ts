import { supabase } from "@/lib/supabase";
import type { Enums, Tables } from "@/types/database";

export async function punchClock(
  assignmentId: string,
  action: "in" | "out"
): Promise<Tables<"shift_clock_records">> {
  const { data, error } = await supabase.rpc("clock_punch", {
    p_assignment: assignmentId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Inizio o fine pausa sulla propria timbratura aperta (con o senza turno). */
export async function clockBreak(
  recordId: string,
  action: "start" | "end"
): Promise<Tables<"shift_clock_breaks">> {
  const { data, error } = await supabase.rpc("clock_break", {
    p_record: recordId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Le pause di una timbratura, dalla prima. */
export async function getClockBreaks(
  recordId: string
): Promise<Tables<"shift_clock_breaks">[]> {
  const { data, error } = await supabase
    .from("shift_clock_breaks")
    .select("*")
    .eq("clock_record_id", recordId)
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function approveClockRecord(
  assignmentId: string
): Promise<Tables<"shift_assignments">> {
  const { data, error } = await supabase.rpc("approve_clock_record", {
    p_assignment: assignmentId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function correctClockRecord(input: {
  recordId: string;
  inAt: string;
  outAt: string;
  reason: string;
}): Promise<Tables<"shift_clock_corrections">> {
  const { data, error } = await supabase.rpc("correct_clock_record", {
    p_record: input.recordId,
    p_in: input.inAt,
    p_out: input.outAt,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** La pausa corretta da chi gestisce le ore: vale più di quella timbrata. */
export async function correctClockBreak(input: {
  recordId: string;
  minutes: number;
  reason: string;
}): Promise<Tables<"shift_clock_corrections">> {
  const { data, error } = await supabase.rpc("correct_clock_break", {
    p_record: input.recordId,
    p_minutes: input.minutes,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function voidClockRecord(
  assignmentId: string,
  reason: string
): Promise<Tables<"shift_clock_records">> {
  const { data, error } = await supabase.rpc("void_clock_record", {
    p_assignment: assignmentId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Pausa retribuita o no, e la regola che la propone nei turni lunghi. I turni
 * già conclusi tengono la scelta con cui si sono svolti.
 */
export async function setVenueBreakPolicy(input: {
  venueId: string;
  paid: boolean;
  ruleAfterMinutes: number | null;
  ruleMinutes: number | null;
}): Promise<Tables<"venues">> {
  const { data, error } = await supabase.rpc("set_venue_break_policy", {
    p_venue: input.venueId,
    p_paid: input.paid,
    p_rule_after_minutes: input.ruleAfterMinutes ?? undefined,
    p_rule_minutes: input.ruleMinutes ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Pausa timbrata (true) o fissa dal turno (false) per la sede. */
export async function setVenueBreakClocked(input: {
  venueId: string;
  clocked: boolean;
}): Promise<Tables<"venues">> {
  const { data, error } = await supabase.rpc("set_venue_break_clocked", {
    p_venue: input.venueId,
    p_clocked: input.clocked,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setVenueClockMethod(
  venueId: string,
  method: Enums<"clock_method">
): Promise<Tables<"venues">> {
  const { data, error } = await supabase.rpc("set_venue_clock_method", {
    p_venue: venueId,
    p_method: method,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Una sede in cui posso timbrare senza turno, con l'eventuale entrata aperta. */
export type MyUnplannedClock = {
  venueMemberId: string;
  venueId: string;
  venueName: string;
  workspaceName: string;
  roles: { id: string; name: string }[];
  open: {
    recordId: string;
    clockInAt: string;
    roleId: string | null;
    note: string | null;
    /** False = pausa fissa: niente pulsante della pausa. */
    breakClocked: boolean;
  } | null;
};

export async function getMyUnplannedClock(): Promise<MyUnplannedClock[]> {
  const { data, error } = await supabase.rpc("get_my_unplanned_clock");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    venueMemberId: row.venue_member_id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    workspaceName: row.workspace_name,
    roles: (row.roles as { id: string; name: string }[] | null) ?? [],
    open: row.open_record_id
      ? {
          recordId: row.open_record_id,
          clockInAt: row.clock_in_at,
          roleId: row.role_id,
          note: row.note,
          breakClocked: row.break_clocked ?? true,
        }
      : null,
  }));
}

export async function punchUnplannedClock(input: {
  venueMemberId: string;
  action: "in" | "out";
  roleId?: string | null;
  note?: string | null;
}): Promise<Tables<"shift_clock_records">> {
  const { data, error } = await supabase.rpc("clock_punch_unplanned", {
    p_venue_member: input.venueMemberId,
    p_action: input.action,
    p_role: input.roleId ?? undefined,
    p_note: input.note?.trim() || undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Una timbratura senza turno ancora aperta, come la vede chi gestisce. */
export type OpenUnplannedClock = {
  recordId: string;
  venueId: string;
  venueName: string;
  venueMemberId: string;
  memberId: string;
  memberName: string;
  avatarUrl: string | null;
  clockInAt: string;
  roleName: string | null;
  note: string | null;
  /** Ha «Ore» su quella sede e non è la propria timbratura. */
  canManage: boolean;
};

export async function getOpenUnplannedClocks(
  workspaceId: string
): Promise<OpenUnplannedClock[]> {
  const { data, error } = await supabase.rpc("get_open_unplanned_clocks", {
    p_workspace: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    recordId: row.record_id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    venueMemberId: row.venue_member_id,
    memberId: row.member_id,
    memberName: row.member_name,
    avatarUrl: row.avatar_url,
    clockInAt: row.clock_in_at,
    roleName: row.role_name,
    note: row.note,
    canManage: row.can_manage,
  }));
}

export async function closeUnplannedClock(input: {
  recordId: string;
  outAt: string;
  reason: string;
}): Promise<Tables<"shift_clock_records">> {
  const { data, error } = await supabase.rpc("close_unplanned_clock", {
    p_record: input.recordId,
    p_out: input.outAt,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function voidUnplannedClock(input: {
  recordId: string;
  reason: string;
}): Promise<Tables<"shift_clock_records">> {
  const { data, error } = await supabase.rpc("void_unplanned_clock", {
    p_record: input.recordId,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setMemberClockUnplanned(
  venueMemberId: string,
  enabled: boolean
): Promise<Tables<"venue_members">> {
  const { data, error } = await supabase.rpc("set_member_clock_unplanned", {
    p_venue_member: venueMemberId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** L'eccezione della persona in una sede; null = come la sede. */
export async function setMemberBreakClocked(
  venueMemberId: string,
  clocked: boolean | null
): Promise<Tables<"venue_members">> {
  const { data, error } = await supabase.rpc("set_member_break_clocked", {
    p_venue_member: venueMemberId,
    p_clocked: clocked ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setMemberClockMethod(
  venueMemberId: string,
  method: Enums<"clock_method"> | null
): Promise<Tables<"venue_members">> {
  const { data, error } = await supabase.rpc("set_member_clock_method", {
    p_venue_member: venueMemberId,
    p_method: method ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}
