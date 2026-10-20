import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { pageSchema } from "./types";

/*
 * Rimborsi e contestazioni Paddle nell'area fondatore. Il server decide cosa
 * chiede un'azione (`attention`); qui si legge e si chiude con una nota.
 */

const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const maybeDate = date.nullable();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const attentionCodes = ["cancel_on_paddle", "upgrade_refunded", "chargeback", "unknown_payment", "refund_reversed", "other"] as const;

const adjustment = z.object({
  environment: z.enum(["sandbox", "live"]),
  adjustment_id: z.string().regex(/^adj_[a-z0-9]+$/),
  workspace_id: id,
  workspace_name: z.string(),
  subscription_id: z.string(),
  subscription_status: z.enum(["active", "past_due", "paused", "canceled"]),
  transaction_id: z.string(),
  transaction_origin: z.string().nullable(),
  action: z.string(),
  adjustment_type: z.enum(["full", "partial"]),
  status: z.enum(["pending_approval", "approved", "rejected", "reversed"]),
  total_cents: z.number().int().nullable(),
  currency: z.string().nullable(),
  covered_starts_at: maybeDate,
  covered_ends_at: maybeDate,
  effect: z.enum(["none", "access_cut", "manual_review"]).nullable(),
  access_cut_at: maybeDate,
  created_at: date,
  last_event_at: date,
  reviewed_at: maybeDate,
  review_note: z.string().nullable(),
  attention: z.enum(attentionCodes).nullable(),
});

export const billingAdjustmentListSchema = pageSchema(adjustment)
  .and(z.object({ generated_at: date, open_total: count }));

export type BillingAdjustment = z.infer<typeof adjustment>;
export type BillingAdjustmentFilters = { workspaceId: string | null; openOnly: boolean; offset: number };
export type ResolveBillingAdjustment = { environment: BillingAdjustment["environment"]; adjustmentId: string; note: string };

function parsed<T extends z.ZodType>(schema: T, result: { data: unknown; error: { message: string } | null }): z.output<T> {
  if (result.error) throw new Error(result.error.message);
  const value = schema.safeParse(result.data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}

export async function listBillingAdjustments(f: BillingAdjustmentFilters) {
  return parsed(billingAdjustmentListSchema, await supabase.rpc("admin_list_billing_adjustments", {
    p_workspace: f.workspaceId ?? undefined, p_open_only: f.openOnly, p_offset: f.offset,
  }));
}

export async function resolveBillingAdjustment(c: ResolveBillingAdjustment) {
  return parsed(adjustment, await supabase.rpc("admin_resolve_billing_adjustment", {
    p_environment: c.environment, p_adjustment: c.adjustmentId, p_note: c.note,
  }));
}

const rejectedEvent = z.object({
  environment: z.enum(["sandbox", "live"]),
  event_id: z.string().regex(/^evt_[a-z0-9]+$/),
  event_type: z.string(),
  error: z.string().nullable(),
  occurred_at: date,
  received_at: date,
  paddle_id: z.string().nullable(),
  workspace_id: id.nullable(),
  workspace_name: z.string().nullable(),
  reviewed_at: maybeDate,
  review_note: z.string().nullable(),
});
export const rejectedEventsSchema = pageSchema(rejectedEvent).and(z.object({ generated_at: date, open_total: count }));
export type RejectedBillingEvent = z.infer<typeof rejectedEvent>;
export type ResolveBillingEvent = { environment: RejectedBillingEvent["environment"]; eventId: string; note: string };

/** Avvisi Paddle scartati dal servizio: da verificare (predefinito) o tutto lo storico. */
export async function listRejectedBillingEvents(openOnly: boolean, offset: number) {
  return parsed(rejectedEventsSchema, await supabase.rpc("admin_list_rejected_billing_events", {
    p_open_only: openOnly, p_offset: offset,
  }));
}

export async function resolveBillingEvent(c: ResolveBillingEvent) {
  const { error } = await supabase.rpc("admin_resolve_billing_event", {
    p_environment: c.environment, p_event_id: c.eventId, p_note: c.note,
  });
  if (error) throw new Error(error.message);
}
