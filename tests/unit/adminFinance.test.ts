import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentMonth, formatMoney, shiftMonth } from "@/features/admin/finance";
import { FinanceOverview } from "../../web/src/admin/Finance";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({ useAdminRead: read }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const env = (environment: "live" | "sandbox") => ({
  environment, currency: "EUR", mrr_cents: 6983, at_risk_mrr_cents: 0,
  subscriptions: { active: 2, past_due: 0, paused: 1, cancel_scheduled: 0 },
  payments: { count: 2, gross_cents: 63318, tax_cents: 11397, fee_cents: 3799, earnings_cents: 48122,
    first_purchases: 2, renewals: 0, upgrades: 0 },
  refunds: { count: 1, total_cents: 3538, earnings_cents: 2690 },
});

describe("Incassi (area fondatore)", () => {
  beforeEach(() => read.mockReset());
  it("clienti reali e sandbox separati, con MRR, pagato, IVA, commissioni e netto", () => {
    read.mockReturnValue({ isPending: false, isFetching: false, isError: false,
      data: { generated_at: "2026-10-20T10:00:00Z", month: "2026-10", environments: [env("live"), env("sandbox")], payouts: null, costs: null } });
    const html = renderToStaticMarkup(createElement(FinanceOverview, { userId: "founder" }));
    expect(html).toContain("Clienti reali");
    expect(html).toContain("Prove, non sono incassi");
    expect(html).toContain("69,83");
    expect(html).toContain("633,18");
    expect(html).toContain("Commissioni Paddle");
    expect(html).toContain("Rimborsi del mese (1)");
    expect(html).toContain("Payout, cioè i bonifici di Paddle, e costi non sono ancora collegati");
  });
  it("mesi e importi", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(currentMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(formatMoney(2417).replace(/\u00a0/g, " ")).toBe("24,17 €");
    expect(formatMoney(null)).toBe("Non disponibile");
  });
});
