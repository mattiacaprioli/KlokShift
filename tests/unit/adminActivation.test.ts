import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import {
  activationPageSchema,
  activationStep,
  daysBetween,
  type ActivationRow,
} from "@/features/admin/activation";

const t = (day: number) => new Date(Date.UTC(2026, 9, day, 10)).toISOString();

function row(over: Partial<ActivationRow> = {}): ActivationRow {
  return {
    workspace_id: "00000000-0000-4000-8000-000000000001",
    workspace_name: "Da Mario",
    classification: "unclassified",
    state: "operational",
    created_at: t(1),
    first_venue_at: t(1),
    trial_started_at: t(2),
    people: 5,
    with_email: 4,
    linked: 3,
    first_shift_at: t(4),
    first_confirmed_at: t(5),
    ...over,
  };
}

describe("attivazione delle aziende", () => {
  it("dice il primo passo che manca, nell'ordine dei Primi passi", () => {
    expect(activationStep(row({ first_venue_at: null }))).toBe("venue");
    expect(activationStep(row({ trial_started_at: null, state: "setup" }))).toBe("trial");
    expect(activationStep(row({ people: 1 }))).toBe("people");
    expect(activationStep(row({ with_email: 1 }))).toBe("email");
    expect(activationStep(row({ first_shift_at: null }))).toBe("shift");
    expect(activationStep(row({ first_confirmed_at: null }))).toBe("confirmed");
    expect(activationStep(row())).toBe("active");
  });

  it("senza prova ma operativa (gratuità del fondatore) non resta ferma alla prova", () => {
    expect(activationStep(row({ trial_started_at: null, state: "operational" }))).toBe("active");
  });

  it("conta i giorni interi, e nessuno se il passo manca", () => {
    expect(daysBetween(t(1), t(4))).toBe(3);
    expect(daysBetween(t(1), null)).toBeNull();
  });

  it("rifiuta una risposta che non somiglia alla RPC", () => {
    const page = { generated_at: t(6), total: 1, limit: 25, offset: 0, items: [row()] };
    expect(activationPageSchema.safeParse(page).success).toBe(true);
    expect(activationPageSchema.safeParse({ ...page, items: [{ ...row(), people: -1 }] }).success).toBe(false);
  });
});
