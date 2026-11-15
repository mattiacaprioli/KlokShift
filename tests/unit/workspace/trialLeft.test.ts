import { describe, expect, it } from "vitest";
import { parseWorkspaceAccess, type WorkspaceAccess } from "@/features/workspace/access";
import { trialLeftLabel } from "@/features/workspace/trialCopy";

/*
 * Quanti giorni di prova restano, detti sotto il nome dell'azienda (come la
 * barra «X giorni» di Deputy). Prima si leggevano solo nella pagina Piano.
 */
function access(source: "trial" | "subscription", until: string): WorkspaceAccess {
  return parseWorkspaceAccess({
    workspace_id: "ws",
    state: "operational",
    source,
    plan: "team",
    operational_from: "2026-11-15T10:00:00+00:00",
    operational_until: until,
    archive_until: "2027-12-15T10:00:00+00:00",
    attendance_until: "2026-12-22T10:00:00+00:00",
    can_operate: true,
    can_read: true,
    can_complete_attendance: true,
    limits: { people: null, venues: 1 },
    usage: { people: 0, venues: 1 },
  });
}

const now = (iso: string) => Date.parse(iso);
const UNTIL = "2026-12-15T10:00:00+00:00";

describe("giorni di prova rimasti", () => {
  it("appena avviata: 30 giorni", () => {
    expect(trialLeftLabel(access("trial", UNTIL), now("2026-11-15T10:00:00+00:00"))).toBe(
      "Prova: ancora 30 giorni"
    );
  });

  it("una frazione di giorno conta come un giorno intero", () => {
    expect(trialLeftLabel(access("trial", UNTIL), now("2026-12-13T12:00:00+00:00"))).toBe(
      "Prova: ancora 2 giorni"
    );
  });

  it("l'ultimo giorno lo dice", () => {
    expect(trialLeftLabel(access("trial", UNTIL), now("2026-12-15T08:00:00+00:00"))).toBe(
      "Prova: ultimo giorno"
    );
  });

  it("niente fuori dalla prova o a prova finita", () => {
    expect(trialLeftLabel(access("subscription", UNTIL), now("2026-11-20T10:00:00+00:00"))).toBeNull();
    expect(trialLeftLabel(access("trial", UNTIL), now("2026-12-15T10:00:01+00:00"))).toBeNull();
    expect(trialLeftLabel(undefined, now("2026-11-20T10:00:00+00:00"))).toBeNull();
  });
});
