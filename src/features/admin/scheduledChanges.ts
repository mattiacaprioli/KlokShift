import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { pageSchema } from "./types";

/*
 * Cambi di piano programmati al rinnovo, nell'area fondatore. Il server decide
 * cosa chiede un'azione (`alert_kind` non chiuso); qui si legge, si chiude con
 * una nota e si ritenta un invio non ancora scaduto.
 */

const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const maybeDate = date.nullable();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// Gemello del CHECK di `billing_scheduled_changes.alert_kind`. `date_not_fixed`:
// cambio di ciclo con gli articoli su Paddle ma la data del rinnovo non rimessa;
// `renewal_overdue`: due ore dopo la data d'effetto nessun avviso del rinnovo.
export const alertKinds = ["not_sent", "failed", "renewal_mismatch", "date_not_fixed", "renewal_overdue"] as const;

const scheduledChange = z.object({
  id,
  workspace_id: id,
  workspace_name: z.string(),
  environment: z.enum(["sandbox", "live"]),
  status: z.enum(["pending", "applied", "confirmed", "canceled", "failed"]),
  close_reason: z.string().nullable(),
  target_plan: z.enum(["base", "team"]),
  target_interval: z.enum(["month", "year"]),
  target_extra_venues: z.number().int().nonnegative(),
  effective_at: date,
  renewal_cents: z.number().int().nonnegative(),
  currency: z.string(),
  attempts: count,
  last_error_code: z.string().nullable(),
  alert_kind: z.enum(alertKinds).nullable(),
  created_at: date,
  applied_at: maybeDate,
  confirmed_at: maybeDate,
  reviewed_at: maybeDate,
  review_note: z.string().nullable(),
  /** Come sulla scheda dell'azienda (`private.member_name`); null senza nome. */
  requested_by_name: z.string().nullable(),
});

export const scheduledChangeListSchema = pageSchema(scheduledChange)
  .and(z.object({ generated_at: date, open_total: count }));

export type ScheduledBillingChange = z.infer<typeof scheduledChange>;
export type ScheduledChangeFilters = { workspaceId: string | null; attentionOnly: boolean; offset: number };

/**
 * Il «{motivo}» dell'avviso `failed`, in poche parole. Decide il motivo di
 * chiusura (`rules_changed`, `paddle_mismatch`, `paddle_error`); il codice
 * d'errore serve solo quando il motivo manca (`paddle_rejected_<HTTP>`).
 */
export function scheduledFailureReason(c: Pick<ScheduledBillingChange, "close_reason" | "last_error_code">): string {
  const code = c.close_reason ?? c.last_error_code ?? "";
  if (code === "rules_changed") return "le regole non valgono più: persone o sedi oltre il piano scelto, oppure azienda non operativa";
  if (code === "paddle_mismatch") return "su Paddle data o articoli sono cambiati";
  if (code === "paddle_error" || code.startsWith("paddle_rejected_")) return "Paddle ha rifiutato il cambio";
  return "errore sconosciuto";
}

/** Gemello del controllo di `admin_retry_scheduled_billing_change`: il server resta l'autorità. */
export function canRetryScheduledChange(c: Pick<ScheduledBillingChange, "status" | "effective_at" | "alert_kind" | "close_reason">, now = new Date()): boolean {
  return (c.status === "pending" || c.status === "failed")
    && new Date(c.effective_at).getTime() > now.getTime()
    && c.alert_kind !== "renewal_mismatch" && c.close_reason !== "renewal_mismatch";
}

export async function listScheduledChanges(f: ScheduledChangeFilters) {
  const { data, error } = await supabase.rpc("admin_list_scheduled_billing_changes", {
    p_workspace: f.workspaceId ?? undefined, p_attention_only: f.attentionOnly, p_limit: 50, p_offset: f.offset,
  });
  if (error) throw new Error(error.message);
  const value = scheduledChangeListSchema.safeParse(data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}

export async function resolveScheduledChange(c: { id: string; note: string }) {
  const { error } = await supabase.rpc("admin_resolve_scheduled_billing_change", { p_id: c.id, p_note: c.note });
  if (error) throw new Error(error.message);
}

export async function retryScheduledChange(changeId: string) {
  const { error } = await supabase.rpc("admin_retry_scheduled_billing_change", { p_id: changeId });
  if (error) throw new Error(error.message);
}
