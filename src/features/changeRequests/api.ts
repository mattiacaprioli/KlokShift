import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import type { Enums, Tables } from "@/types/database";

export type ChangeRequest = Tables<"shift_change_requests">;
export type ChangeRequestKind = Enums<"change_request_kind">;

/**
 * Cosa sta chiedendo il professionista.
 *
 * `hours` non è una mezza sostituzione: dice «ci sono, ma su un altro orario».
 * Approvarla **non scrive niente** — è un accordo, e l'orario del turno lo
 * cambia poi il titolare dal pannello (vedi la migration 20260915140000).
 */
export const CHANGE_REQUEST_KIND_LABEL: Record<ChangeRequestKind, string> = {
  substitution: "Sostituzione",
  hours: "Orario diverso",
};

/**
 * Richieste di sostituzione su un turno.
 *
 * Tutte le scritture passano da tre RPC `security definer` (migration
 * 20260915120000): la tabella è in sola lettura per entrambe le parti, perché
 * una riga che decide chi lavora non si scrive da un client.
 *
 * ⚠️ Gli errori delle RPC sono frasi scritte per essere lette («Il turno è già
 * concluso», «Hai già una richiesta aperta su questo turno»): vanno mostrate
 * così come sono, quindi `UserFacingError` e non il messaggio generico. Stessa
 * scelta di `reassignShiftAssignment`.
 */
export async function requestShiftChange(input: {
  assignmentId: string;
  reason: string;
  kind: ChangeRequestKind;
  /** Solo per `hours`, formato "HH:MM". Obbligatori entrambi: il DB li pretende. */
  startTime?: string | null;
  endTime?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("request_shift_change", {
    p_assignment: input.assignmentId,
    p_reason: input.reason,
    p_kind: input.kind,
    p_start: input.kind === "hours" ? (input.startTime ?? undefined) : undefined,
    p_end: input.kind === "hours" ? (input.endTime ?? undefined) : undefined,
  });
  if (error) throw new UserFacingError(error.message);
  return data as string;
}

export async function resolveShiftChangeRequest(input: {
  requestId: string;
  approve: boolean;
  /** `staff_members.id` di chi copre il turno. Null = il posto resta scoperto. */
  replacementStaffMemberId?: string | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("resolve_shift_change_request", {
    p_request: input.requestId,
    p_approve: input.approve,
    p_replacement: input.replacementStaffMemberId ?? undefined,
    p_note: input.note?.trim() || undefined,
  });
  if (error) throw new UserFacingError(error.message);
}

export async function withdrawShiftChangeRequest(
  requestId: string
): Promise<void> {
  const { error } = await supabase.rpc("withdraw_shift_change_request", {
    p_request: requestId,
  });
  if (error) throw new UserFacingError(error.message);
}

/** Una richiesta per id: è quanto serve alla card dentro il thread di chat. */
export async function getChangeRequest(
  requestId: string
): Promise<ChangeRequest | null> {
  const { data, error } = await supabase
    .from("shift_change_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Le richieste ancora aperte su un turno, per la riga «cambio richiesto» nel
 * pannello del titolare. La RLS fa già il filtro giusto: il titolare vede quelle
 * dei suoi turni, il professionista solo le proprie.
 */
export async function getPendingRequestsForShift(
  shiftId: string
): Promise<ChangeRequest[]> {
  const { data, error } = await supabase
    .from("shift_change_requests")
    .select("*")
    .eq("shift_id", shiftId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return data ?? [];
}
