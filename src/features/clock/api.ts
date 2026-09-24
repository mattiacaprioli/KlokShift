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
