import { describe, expect, it } from "vitest";
import {
  computeFirstSteps,
  parseFirstStepsMemory,
  type FirstStepsInput,
} from "@/features/onboarding/firstSteps";
import { parseWorkspaceAccess, type WorkspaceAccess } from "@/features/workspace/access";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function access(state: "setup" | "operational" | "migration_pending" | "archive"): WorkspaceAccess {
  const open = state === "operational" || state === "archive";
  return parseWorkspaceAccess({
    workspace_id: "ws",
    state,
    source: open ? "trial" : null,
    plan: open ? "team" : null,
    operational_from: open ? "2026-10-05T10:00:00+00:00" : null,
    operational_until: open ? "2026-11-04T10:00:00+00:00" : null,
    archive_until: open ? "2027-11-04T10:00:00+00:00" : null,
    attendance_until: open ? "2026-11-11T10:00:00+00:00" : null,
    can_operate: state === "operational",
    can_read: true,
    can_complete_attendance: state === "operational",
    limits: open ? { people: null, venues: 1 } : { people: null, venues: null },
    usage: { people: 0, venues: 1 },
  });
}

const person = (p: Partial<{ waiter_id: string | null; invited_at: string | null; email: string | null }> = {}) => ({
  waiter_id: null, invited_at: null, email: null, ...p,
});

function input(over: Partial<FirstStepsInput> = {}): FirstStepsInput {
  return {
    isOwner: true,
    access: access("operational"),
    hasVenue: true,
    myUserId: ME,
    activeRoleCount: 0,
    people: [],
    hasAnyShift: false,
    ...over,
  };
}

const status = (s: ReturnType<typeof computeFirstSteps>) =>
  Object.fromEntries(s.steps.map((step) => [step.id, step.status]));

describe("primi passi del titolare", () => {
  it("in preparazione c'è solo la prova da fare, il resto è bloccato e pronto senza altri dati", () => {
    const s = computeFirstSteps(input({
      access: access("setup"), activeRoleCount: undefined, people: undefined, hasAnyShift: undefined,
    }));
    expect(s.visible).toBe(true);
    expect(s.ready).toBe(true);
    expect(status(s)).toEqual({ trial: "todo", roles: "locked", people: "locked", shift: "locked", team: "locked" });
    expect(s.next?.id).toBe("trial");
    // Chiusa adesso, al titolare non resterebbe nessun invito ad avviarla.
    expect(s.canDismiss).toBe(false);
  });

  it("a prova avviata aspetta tutti i dati prima di mostrarsi", () => {
    expect(computeFirstSteps(input({ activeRoleCount: undefined })).ready).toBe(false);
    expect(computeFirstSteps(input({ people: undefined })).ready).toBe(false);
    expect(computeFirstSteps(input({ hasAnyShift: undefined })).ready).toBe(false);
    expect(computeFirstSteps(input()).ready).toBe(true);
  });

  it("subito dopo la prova il prossimo passo sono i ruoli, e si può chiudere", () => {
    const s = computeFirstSteps(input());
    expect(status(s)).toEqual({ trial: "done", roles: "todo", people: "todo", shift: "todo", team: "todo" });
    expect(s.next?.id).toBe("roles");
    expect(s.doneCount).toBe(1);
    expect(s.canDismiss).toBe(true);
  });

  it("il titolare da solo in organico non conta come persone aggiunte", () => {
    const s = computeFirstSteps(input({ activeRoleCount: 2, people: [person({ waiter_id: ME })] }));
    expect(status(s).people).toBe("todo");
    expect(status(s).team).toBe("todo");
    expect(s.next?.id).toBe("people");
  });

  it("persone senza email: il passo del team dice cosa manca", () => {
    const s = computeFirstSteps(input({ activeRoleCount: 1, people: [person()], hasAnyShift: true }));
    expect(status(s).people).toBe("done");
    const team = s.steps.find((step) => step.id === "team")!;
    expect(team.status).toBe("todo");
    expect(team.detail).toMatch(/email/);
  });

  it("un invito spedito o un account collegato chiudono il passo del team", () => {
    for (const p of [person({ invited_at: "2026-10-20T10:00:00Z", email: "a@b.it" }), person({ waiter_id: OTHER })]) {
      const s = computeFirstSteps(input({ activeRoleCount: 1, people: [p], hasAnyShift: true }));
      expect(status(s).team).toBe("done");
      expect(s.allDone).toBe(true);
      expect(s.next).toBeNull();
    }
  });

  it("un'azienda preesistente in migrazione ha la prova già spuntata", () => {
    const s = computeFirstSteps(input({ access: access("migration_pending") }));
    expect(s.visible).toBe(true);
    expect(status(s).trial).toBe("done");
  });

  it("non si mostra a chi non è titolare, senza sede o in archivio", () => {
    expect(computeFirstSteps(input({ isOwner: false })).visible).toBe(false);
    expect(computeFirstSteps(input({ hasVenue: false })).visible).toBe(false);
    expect(computeFirstSteps(input({ access: access("archive") })).visible).toBe(false);
    expect(computeFirstSteps(input({ access: undefined })).visible).toBe(false);
  });

  it("la memoria accetta solo i due valori noti", () => {
    expect(parseFirstStepsMemory("dismissed")).toBe("dismissed");
    expect(parseFirstStepsMemory("completed")).toBe("completed");
    expect(parseFirstStepsMemory("boh")).toBeNull();
    expect(parseFirstStepsMemory(null)).toBeNull();
  });
});
