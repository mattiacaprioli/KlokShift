import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
const { paymentLinkTransaction } = await import("../../web/src/billing/checkout");

describe("link delle email Paddle", () => {
  it("riconosce solo una transazione valida", () => {
    expect(paymentLinkTransaction("?_ptxn=txn_01h2b0qpjc0xt8k5aw6nsdec4p")).toBe("txn_01h2b0qpjc0xt8k5aw6nsdec4p");
    expect(paymentLinkTransaction("?a=1&_ptxn=txn_01abc")).toBe("txn_01abc");
    expect(paymentLinkTransaction("")).toBeNull();
    expect(paymentLinkTransaction("?_ptxn=<script>")).toBeNull();
    expect(paymentLinkTransaction("?_ptxn=sub_01abc")).toBeNull();
  });
});
