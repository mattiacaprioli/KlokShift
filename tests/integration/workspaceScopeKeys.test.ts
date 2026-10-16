import { describe, expect, it } from "vitest";

import { qk } from "@/lib/queryKeys";

describe("cache dei report per azienda", () => {
  const workspaceA = "workspace-a";
  const workspaceB = "workspace-b";
  const month = "2026-09";

  it("usa chiavi diverse per ore, riepilogo e liste assenze", () => {
    expect(qk.staff.ownerHours(workspaceA, month)).not.toEqual(
      qk.staff.ownerHours(workspaceB, month)
    );
    expect(qk.absences.summary(workspaceA, month)).not.toEqual(
      qk.absences.summary(workspaceB, month)
    );
    expect(qk.absences.toHandle(workspaceA)).not.toEqual(
      qk.absences.toHandle(workspaceB)
    );
    expect(qk.absences.company(workspaceA)).not.toEqual(
      qk.absences.company(workspaceB)
    );
  });
});
