import { describe, expect, it } from "vitest";

import { recordAbsenceOptions } from "@/features/absences/recordFor";

const people = [
  { id: "a", full_name: "Andrea", waiter_id: "u-a", memberships: [{ venue_id: "v1" }] },
  { id: "f", full_name: "Francesca", waiter_id: null, memberships: [{ venue_id: "v2" }] },
  { id: "me", full_name: "Mattia", waiter_id: "u-me", memberships: [{ venue_id: "v1" }] },
  { id: "c", full_name: "Solo gestione", waiter_id: "u-c", memberships: [] },
];

describe("recordAbsenceOptions", () => {
  it("il titolare trova sé stesso in cima e tutto il team", () => {
    const out = recordAbsenceOptions(people, {
      myId: "u-me",
      isOwner: true,
      canStaffOn: () => true,
    });
    expect(out.map((o) => o.id)).toEqual(["me", "a", "f"]);
    expect(out[0].isMe).toBe(true);
  });

  it("il collaboratore non trova sé stesso né chi è fuori dalle sue sedi", () => {
    const out = recordAbsenceOptions(people, {
      myId: "u-me",
      isOwner: false,
      canStaffOn: (v) => v === "v1",
    });
    expect(out.map((o) => o.id)).toEqual(["a"]);
  });

  it("chi non è nel team di nessuna sede non compare", () => {
    const out = recordAbsenceOptions(people, {
      myId: "u-x",
      isOwner: true,
      canStaffOn: () => true,
    });
    expect(out.map((o) => o.id)).not.toContain("c");
  });
});
