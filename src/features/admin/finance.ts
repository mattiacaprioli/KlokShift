import { z } from "zod";
import { supabase } from "@/lib/supabase";

/*
 * Incassi nell'area fondatore: dati verificati da Paddle, in centesimi, per
 * ambiente (sandbox / live) e valuta, mai sommati fra loro. Payout e costi non
 * sono ancora collegati: il server li restituisce `null`, non zero.
 */

const date = z.iso.datetime({ offset: true });
const cents = z.number();
const count = z.number().int().nonnegative();
const env = z.enum(["sandbox", "live"]);

const environment = z.object({
  environment: env, currency: z.string(),
  mrr_cents: cents, at_risk_mrr_cents: cents,
  subscriptions: z.object({ active: count, past_due: count, paused: count, cancel_scheduled: count }),
  payments: z.object({ count, gross_cents: cents, tax_cents: cents, fee_cents: cents, earnings_cents: cents,
    first_purchases: count, renewals: count, upgrades: count }),
  refunds: z.object({ count, total_cents: cents, earnings_cents: cents }),
});
export const financeSchema = z.object({
  generated_at: date, month: z.string().regex(/^\d{4}-\d{2}$/),
  environments: z.array(environment), payouts: z.null(), costs: z.null(),
});
export const workspaceFinanceSchema = z.object({
  generated_at: date,
  subscriptions: z.array(z.object({
    environment: env, status: z.enum(["active", "past_due", "paused", "canceled"]), plan: z.enum(["base", "team"]),
    billing_interval: z.enum(["month", "year"]), extra_venues: count, current_period_ends_at: date.nullable(),
    scheduled_change: z.string().nullable(), created_at: date, currency: z.string(),
    recurring_cents: cents, mrr_cents: cents,
  })),
  payments: z.array(z.object({
    environment: env, billed_at: date, origin: z.string().nullable(), currency: z.string().nullable(),
    gross_cents: cents.nullable(), tax_cents: cents.nullable(), fee_cents: cents.nullable(), earnings_cents: cents.nullable(),
  })),
  refunds: z.array(z.object({
    environment: env, status: z.string(), action: z.string(), total_cents: cents.nullable(),
    currency: z.string().nullable(), at: date, effect: z.string().nullable(),
  })),
});
export type Finance = z.infer<typeof financeSchema>;
export type FinanceEnvironment = z.infer<typeof environment>;
export type WorkspaceFinance = z.infer<typeof workspaceFinanceSchema>;

function parsed<T extends z.ZodType>(schema: T, result: { data: unknown; error: { message: string } | null }): z.output<T> {
  if (result.error) throw new Error(result.error.message);
  const value = schema.safeParse(result.data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}

/** `month` come `YYYY-MM`; il server lo intende nell'ora italiana. */
export async function getAdminFinance(month: string) {
  return parsed(financeSchema, await supabase.rpc("admin_get_finance", { p_month: `${month}-01` }));
}

export async function getAdminWorkspaceFinance(workspaceId: string) {
  return parsed(workspaceFinanceSchema, await supabase.rpc("admin_get_workspace_finance", { p_workspace: workspaceId }));
}

export function formatMoney(value: number | null | undefined, currency = "EUR"): string {
  if (value === null || value === undefined) return "Non disponibile";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value / 100);
}

/** Il mese prima o dopo, in `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).format(now);
}
