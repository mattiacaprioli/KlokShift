import { describe, expect, it } from "vitest";
import {
  parseWorkspaceAccess,
  workspaceAccessRefetchDelay,
  canUseWorkspaceOperations,
  operationsGate,
  workspaceAccessMessage,
} from "@/features/workspace/access";
import { TRIAL_COPY } from "@/features/workspace/trialCopy";
import { canCreateVenue, venueNewMode } from "@/features/venues/gate";

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
  it("calibra la scadenza sull'istante server anche con orologio locale avanti", () => {
    const access = parseWorkspaceAccess({ ...trial(), server_now: "2026-11-04T09:59:00Z" });
    const local = Date.parse("2027-01-01T10:00:00Z");
    expect(workspaceAccessRefetchDelay(access, local, local)).toBe(60_250);
    expect(workspaceAccessRefetchDelay(access, local + 10_000, local)).toBe(50_250);
  });

  it("programma il refresh per una concessione futura anche in setup", () => {
    const access = parseWorkspaceAccess({ ...trial(), state: "setup", source: null, plan: null,
      operational_from: null, operational_until: null, archive_until: null, attendance_until: null,
      can_operate: false, can_complete_attendance: false, limits: { people: null, venues: null },
      server_now: "2026-10-05T09:00:00Z", next_change_at: "2026-10-05T10:00:00Z" });
    expect(workspaceAccessRefetchDelay(access, 100, 100)).toBe(3_600_250);
  });

  it("distingue la compatibilità di migrazione dall'assenza di dati", () => {
    const access = parseWorkspaceAccess({ ...trial(), state: "migration_pending", source: null, plan: null,
      operational_from: null, operational_until: null, archive_until: null, attendance_until: null,
      can_operate: false, can_complete_attendance: false, limits: { people: null, venues: null } });
    expect(canUseWorkspaceOperations(access)).toBe(true);
    expect(access.can_operate).toBe(false);
    expect(canUseWorkspaceOperations(undefined)).toBe(false);
    expect(canCreateVenue({ access }).allowed).toBe(true);
    expect(canCreateVenue({ access: undefined }).allowed).toBe(false);
  });

  it("il gate sedi usa l'uso aziendale e non le sedi visibili", () => {
    expect(canCreateVenue({ access: parseWorkspaceAccess(trial()) }).allowed).toBe(false);
    expect(canCreateVenue({ access: parseWorkspaceAccess({ ...trial(), limits: { people: null, venues: 2 } }) }).allowed).toBe(true);
    expect(canCreateVenue({ access: parseWorkspaceAccess({ ...trial(), state: "archive", can_operate: false }) }).allowed).toBe(false);
  });
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
    ["abbonamento", "subscription", "Abbonamento attivo."],
    ["tolleranza di pagamento", "payment_grace", "Il rinnovo dell'abbonamento non è andato a buon fine. Puoi continuare a lavorare ancora per pochi giorni: il titolare può sistemarlo."],
  ])("accetta l'origine %s, con scadenza e messaggio neutro", (_name, source, message) => {
    const access = parseWorkspaceAccess({ ...trial(), source, plan: "base", limits: { people: 30, venues: 2 } });
    expect(access.source).toBe(source);
    expect(workspaceAccessMessage(access)).toBe(message);
    // Nell'app nativa niente prezzi né inviti all'acquisto (App Store 3.1.3).
    expect(workspaceAccessMessage(access)).not.toMatch(/€|acquist|compra|paga ora/i);
  });

  it("un abbonamento senza fine del periodo non è valido", () => {
    expect(() => parseWorkspaceAccess({ ...trial(), source: "subscription", operational_until: null }))
      .toThrow("workspace_access_invalid");
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

describe("nuova sede: quale schermata", () => {
  const base = {
    isPending: false,
    isError: false,
    workspaceId: "ws",
    isOwner: true,
    accessPending: false,
  };

  it("aspetta il contesto prima di decidere", () => {
    expect(venueNewMode({ ...base, isPending: true, workspaceId: undefined })).toBe("loading");
    expect(venueNewMode({ ...base, isPending: true })).toBe("loading");
  });

  it("con il contesto in errore non apre mai una prima azienda", () => {
    expect(venueNewMode({ ...base, isError: true, workspaceId: undefined, isOwner: false })).toBe("error");
    expect(venueNewMode({ ...base, isError: true })).toBe("error");
  });

  it("prima azienda solo con il contesto caricato e nessuna azienda da gestire", () => {
    expect(venueNewMode({ ...base, workspaceId: undefined, isOwner: false })).toBe("first");
  });

  it("nell'azienda di un altro la sede la apre solo il titolare", () => {
    expect(venueNewMode({ ...base, isOwner: false })).toBe("denied");
    expect(venueNewMode({ ...base, isOwner: false, accessPending: true })).toBe("denied");
  });

  it("il titolare aspetta lo stato commerciale, poi decide canCreateVenue", () => {
    expect(venueNewMode({ ...base, accessPending: true })).toBe("loading");
    expect(venueNewMode(base)).toBe("add");
  });
});

describe("azienda in preparazione: cosa si dice e a chi", () => {
  function setup(venues: number, usage: boolean = true) {
    return parseWorkspaceAccess({ ...trial(), state: "setup", source: null, plan: null,
      operational_from: null, operational_until: null, archive_until: null, attendance_until: null,
      can_operate: false, can_complete_attendance: false, limits: { people: null, venues: null },
      usage: usage ? { people: 0, venues } : null });
  }

  it("con la sede già aperta chiede solo di avviare la prova", () => {
    expect(workspaceAccessMessage(setup(1))).toMatch(/avvia la prova/);
    expect(workspaceAccessMessage(setup(1))).not.toMatch(/prima sede/);
    expect(workspaceAccessMessage(setup(0))).toMatch(/Apri una sede/);
  });

  it("a chi non è titolare non chiede di fare quello che non può", () => {
    expect(workspaceAccessMessage(setup(1, false), { isOwner: false })).toMatch(/il titolare deve/);
  });

  it("il titolare con la sede aperta può avviare la prova da un pulsante bloccato", () => {
    const gate = operationsGate(setup(1), { isOwner: true });
    expect(gate).toMatchObject({ allowed: false, canStartTrial: true });
  });

  it("senza sede, o per un collaboratore, niente scorciatoia alla prova", () => {
    expect(operationsGate(setup(0), { isOwner: true })).toMatchObject({ allowed: false, canStartTrial: false });
    expect(operationsGate(setup(1, false), { isOwner: false })).toMatchObject({ allowed: false, canStartTrial: false });
  });

  it("operativa o in migrazione lascia passare; in archivio spiega senza prova", () => {
    expect(operationsGate(parseWorkspaceAccess(trial()), { isOwner: true }).allowed).toBe(true);
    const pending = parseWorkspaceAccess({ ...trial(), state: "migration_pending", source: null, plan: null,
      operational_from: null, operational_until: null, archive_until: null, attendance_until: null,
      can_operate: false, can_complete_attendance: false, limits: { people: null, venues: null } });
    expect(operationsGate(pending, { isOwner: true }).allowed).toBe(true);
    const archive = parseWorkspaceAccess({ ...trial(), state: "archive", can_operate: false });
    expect(operationsGate(archive, { isOwner: true })).toMatchObject({ allowed: false, canStartTrial: false });
    expect(operationsGate(undefined, { isOwner: true }).allowed).toBe(false);
  });

  it("i testi della prova e dei blocchi non nominano prezzi né acquisti (app nativa)", () => {
    const texts = [
      ...Object.values(TRIAL_COPY).flat(),
      ...[setup(1), setup(0)].flatMap((a) => [
        workspaceAccessMessage(a),
        workspaceAccessMessage(a, { isOwner: false }),
        ...[true, false].map((isOwner) => {
          const gate = operationsGate(a, { isOwner });
          return gate.allowed ? "" : gate.reason;
        }),
      ]),
    ];
    for (const text of texts) expect(text).not.toMatch(/€|acquist|compra|paga|abbonament/i);
  });
});
