import { describe, expect, it } from "vitest";
import {
  TEAM_PERMISSIONS,
  missingPermission,
} from "@/features/workspace/permissions";

describe("permesso mancante", () => {
  it("nomina il permesso, dice cosa permette e a chi chiederlo", () => {
    expect(missingPermission("can_view_hours")).toEqual({
      title: "Ti manca il permesso «Ore ed export»",
      detail:
        "Chi ha «Ore ed export» vede le ore lavorate e scarica gli export. Se ti serve, chiedilo al titolare.",
    });
  });

  it("ha una frase per ogni permesso", () => {
    for (const perm of TEAM_PERMISSIONS) {
      const { title, detail } = missingPermission(perm);
      expect(title).toMatch(/^Ti manca il permesso «.+»$/);
      expect(detail).toMatch(/chiedilo al titolare\.$/);
    }
  });
});
