import { describe, expect, it } from "vitest";
import {
  parseWorkspaceAccess,
  workspaceAccessRefetchDelay,
} from "@/features/workspace/access";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function trial() {
  return {
    workspace_id: workspaceId,
    state: "operational",
    source: "trial",
    plan: "team",
    operational_from: "2026-10-05T10:00:00+00:00",
    operational_until: "2026-11-04T10:00:00+00:00",
    archive_until: "2027-11-04T10:00:00+00:00",
    attendance_until: "2026-11-11T10:00:00+00:00",
    can_operate: true,
    can_read: true,
    can_complete_attendance: true,
    limits: { people: null, venues: 1 },
    usage: { people: 45, venues: 1 },
  };
}

describe("accesso commerciale aziendale", () => {
  it("riconosce la prova Team senza confonderla con una capacità mancante", () => {
    const access = parseWorkspaceAccess(trial());
    expect(access.plan).toBe("team");
    expect(access.limits.people).toBeNull();
    expect(access.limits.venues).toBe(1);
    expect(access.usage?.people).toBe(45);
    expect(access.can_operate).toBe(true);
  });

  it("accetta una concessione permanente esplicita senza scadenza", () => {
    const access = parseWorkspaceAccess({
      ...trial(),
      source: "complimentary_lifetime",
      plan: "base",
      operational_until: null,
      archive_until: null,
      attendance_until: null,
      limits: { people: 30, venues: 3 },
    });
    expect(access.operational_until).toBeNull();
    expect(access.limits).toEqual({ people: 30, venues: 3 });
  });

  it("conserva la consultazione quando termina l'operatività", () => {
    const access = parseWorkspaceAccess({
      ...trial(),
      state: "archive",
      can_operate: false,
      can_complete_attendance: false,
    });
    expect(access.can_operate).toBe(false);
    expect(access.can_read).toBe(true);
  });

  it("non inventa un piano per un'azienda ancora da configurare", () => {
    const access = parseWorkspaceAccess({
      ...trial(),
      state: "setup",
      source: null,
      plan: null,
      operational_from: null,
      operational_until: null,
      archive_until: null,
      attendance_until: null,
      can_operate: false,
      can_complete_attendance: false,
      limits: { people: null, venues: null },
    });
    expect(access.plan).toBeNull();
    expect(access.can_operate).toBe(false);
  });

  it("permette di omettere gli aggregati per chi lavora nell'azienda", () => {
    expect(parseWorkspaceAccess({ ...trial(), usage: null }).usage).toBeNull();
  });

  it("rilegge una prova scaduta già presente nella cache", () => {
    const delay = workspaceAccessRefetchDelay(
      parseWorkspaceAccess(trial()),
      Date.parse("2026-11-04T10:00:01Z")
    );
    expect(delay).toBeTypeOf("number");
    expect(delay).toBeLessThanOrEqual(1_000);
  });

  it("rilegge l'archivio quando la possibilità di rettifica è appena terminata", () => {
    const access = parseWorkspaceAccess({
      ...trial(), state: "archive", can_operate: false,
    });
    const delay = workspaceAccessRefetchDelay(
      access, Date.parse("2026-11-11T10:00:01Z")
    );
    expect(delay).toBeTypeOf("number");
    expect(delay).toBeLessThanOrEqual(1_000);
  });

  it("non rilegge continuamente una rettifica già terminata e confermata dal server", () => {
    const access = parseWorkspaceAccess({
      ...trial(), state: "archive", can_operate: false, can_complete_attendance: false,
    });
    const delay = workspaceAccessRefetchDelay(
      access, Date.parse("2026-11-11T10:00:01Z")
    );
    expect(delay).toBeTypeOf("number");
    expect(delay).toBeGreaterThan(60_000);
  });

  it("non programma polling per una concessione permanente", () => {
    const access = parseWorkspaceAccess({
      ...trial(), source: "complimentary_lifetime", operational_until: null,
      archive_until: null, attendance_until: null,
    });
    expect(workspaceAccessRefetchDelay(access)).toBe(false);
  });

  it.each([
    ["risposta assente", null],
    ["oggetto vuoto", {}],
    ["stato sconosciuto", { ...trial(), state: "pro" }],
    ["vecchio piano", { ...trial(), plan: "pro" }],
    ["origine sconosciuta", { ...trial(), source: "coupon" }],
    ["flag non booleano", { ...trial(), can_operate: "true" }],
    ["capacità assente", { ...trial(), limits: {} }],
    ["sedi infinite implicite", { ...trial(), limits: { people: null, venues: null } }],
    ["sedi zero", { ...trial(), limits: { people: null, venues: 0 } }],
    ["sedi frazionarie", { ...trial(), limits: { people: null, venues: 1.5 } }],
    ["organico negativo", { ...trial(), usage: { people: -1, venues: 1 } }],
    ["data non valida", { ...trial(), operational_until: "non una data" }],
    ["prova senza scadenza", { ...trial(), operational_until: null }],
    ["azienda senza identificativo", { ...trial(), workspace_id: "" }],
  ])("rifiuta %s senza concedere accesso per default", (_name, payload) => {
    expect(() => parseWorkspaceAccess(payload)).toThrow("workspace_access_invalid");
  });
});
