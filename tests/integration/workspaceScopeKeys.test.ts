import { describe, expect, it } from "vitest";

import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";

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

  it("mantiene separati i risultati quando si cambia azienda", () => {
    const client = createTestQueryClient();
    const keyA = qk.absences.company(workspaceA);
    const keyB = qk.absences.company(workspaceB);

    client.setQueryData(keyA, ["assenza-a"]);
    client.setQueryData(keyB, ["assenza-b"]);

    expect(client.getQueryData(keyA)).toEqual(["assenza-a"]);
    expect(client.getQueryData(keyB)).toEqual(["assenza-b"]);
    client.clear();
  });
});
