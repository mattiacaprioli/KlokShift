import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { PLAN_BANDS, planBandLabel, planOptionLabel, planRank, smallestBandFor } from "@/features/workspace/planBands";
import { parseWorkspaceAccess } from "@/features/workspace/access";
import { operationsSchema } from "@/features/admin/controls";

describe("fasce di dimensione", () => {
  it("i limiti di persone sono quelli di private.plan_people_limit", () => {
    expect(PLAN_BANDS.base.people).toBe(15);
    expect(PLAN_BANDS.team.people).toBe(40);
    expect(PLAN_BANDS.large.people).toBe(100);
    expect(PLAN_BANDS.custom.people).toBeNull();
  });
  it("nomi e ordine", () => {
    expect(PLAN_BANDS.base.label).toBe("Piccola");
    expect(PLAN_BANDS.team.label).toBe("Media");
    expect(PLAN_BANDS.large.label).toBe("Grande");
    expect(PLAN_BANDS.custom.label).toBe("Su misura");
    expect([planRank("base"), planRank("team"), planRank("large")]).toEqual([1, 2, 3]);
  });
  it("etichetta dell'opzione", () => {
    expect(planOptionLabel("base")).toBe("Piccola · fino a 15 persone");
    expect(planOptionLabel("large")).toBe("Grande · fino a 100 persone");
    expect(planOptionLabel("custom")).toBe("Su misura · senza limite di persone");
  });
});

describe("aiuti per il fondatore", () => {
  it("etichetta della fascia, anche mancante o sconosciuta", () => {
    expect(planBandLabel("team")).toBe("Media");
    expect(planBandLabel("custom")).toBe("Su misura");
    expect(planBandLabel(null)).toBe("piano non assegnato");
    expect(planBandLabel("xl")).toBe("piano non assegnato");
  });
  it("concessione proposta: la fascia più piccola che contiene l'uso", () => {
    expect(smallestBandFor(3)).toBe("base");
    expect(smallestBandFor(15)).toBe("base");
    expect(smallestBandFor(16)).toBe("team");
    expect(smallestBandFor(41)).toBe("large");
    expect(smallestBandFor(101)).toBe("custom");
    expect(smallestBandFor(undefined)).toBe("custom");
  });
});

const access = (plan: string, people: number | null) => ({
  workspace_id: "azienda", state: "operational", source: "complimentary_lifetime", plan,
  operational_from: "2026-10-05T10:00:00+00:00", operational_until: null,
  archive_until: null, attendance_until: null,
  can_operate: true, can_read: true, can_complete_attendance: true,
  limits: { people, venues: 1 }, usage: { people: 3, venues: 1 },
});

describe("accesso con le fasce", () => {
  it("accetta large e custom coi loro limiti", () => {
    expect(parseWorkspaceAccess(access("large", 100)).plan).toBe("large");
    expect(parseWorkspaceAccess(access("custom", null)).plan).toBe("custom");
  });
  it("accetta i limiti che manda il server, anche quelli di prima delle fasce", () => {
    // Le build native già installate e le foto storiche del registro: il server decide.
    expect(parseWorkspaceAccess(access("base", 15)).limits.people).toBe(15);
    expect(parseWorkspaceAccess(access("base", 30)).limits.people).toBe(30);
    expect(parseWorkspaceAccess(access("team", null)).limits.people).toBeNull();
    expect(parseWorkspaceAccess(access("large", 100)).limits.people).toBe(100);
  });
  it("una fascia sconosciuta non blocca: piano non assegnato, il resto com'è", () => {
    const parsed = parseWorkspaceAccess(access("xl", 250));
    expect(parsed.plan).toBeNull();
    expect(parsed.state).toBe("operational");
    expect(parsed.can_operate).toBe(true);
    expect(parsed.limits).toEqual({ people: 250, venues: 1 });
    expect(parsed.usage).toEqual({ people: 3, venues: 1 });
  });
  it("rifiuta un limite di persone non valido o un piano mancante", () => {
    expect(() => parseWorkspaceAccess(access("base", 0))).toThrow("workspace_access_invalid");
    expect(() => parseWorkspaceAccess(access("base", 1.5))).toThrow("workspace_access_invalid");
    expect(() => parseWorkspaceAccess({ ...access("base", 15), plan: null })).toThrow("workspace_access_invalid");
    expect(() => parseWorkspaceAccess({ ...access("base", 15), plan: 7 })).toThrow("workspace_access_invalid");
  });
});

describe("cronologia con la migrazione delle fasce", () => {
  const page = (items: unknown[]) => ({
    items, total: items.length, limit: 25, offset: 0,
    generated_at: "2026-11-22T10:00:00+00:00", target_kind: "workspace",
    target_id: "22222222-2222-4222-8222-222222222222",
  });
  const lifetime = (plan: string) => ({
    period_id: "33333333-3333-4333-8333-333333333333", plan, venue_limit: 1, document_limit_bytes: 2147483648,
  });
  it("legge la riga senza attore", () => {
    const row = {
      operation_id: "11111111-1111-4111-8111-111111111111", actor_id: null,
      action: "plan_band_migration", reason: "Passaggio alle fasce",
      before_state: {}, after_state: {}, applied_at: "2026-11-22T10:00:00+00:00",
    };
    expect(operationsSchema.safeParse(page([row])).success).toBe(true);
  });
  it("legge le foto storiche team/senza limite e base/30", () => {
    const migration = {
      operation_id: "11111111-1111-4111-8111-111111111111", actor_id: null,
      action: "plan_band_migration", reason: "Listino a fasce del 22/11: perimetro senza limite mantenuto",
      before_state: { classification: "customer", access: access("team", null), lifetime: lifetime("team") },
      after_state: { classification: "customer", access: access("custom", null), lifetime: lifetime("custom") },
      applied_at: "2026-11-22T10:00:00+00:00",
    };
    const oldGrant = {
      operation_id: "44444444-4444-4444-8444-444444444444", actor_id: "55555555-5555-4555-8555-555555555555",
      action: "grant_lifetime", reason: "Concessione",
      before_state: { classification: "customer", access: access("base", 30), lifetime: null },
      after_state: { classification: "customer", access: access("team", null), lifetime: lifetime("team") },
      applied_at: "2026-10-06T19:12:00+00:00",
    };
    const result = operationsSchema.safeParse(page([migration, oldGrant]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].before_state.access?.plan).toBe("team");
      expect(result.data.items[1].before_state.access?.limits.people).toBe(30);
    }
  });
});
