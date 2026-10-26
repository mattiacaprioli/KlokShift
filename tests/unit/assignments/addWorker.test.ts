import { describe, expect, it } from "vitest";

import { shiftWorkerCandidates } from "@/features/assignments/addWorker";
import { defaultRoleFor } from "@/features/assignments/defaultRole";

const person = (id: string, link_status = "active", waiter_id: string | null = `user-${id}`) => ({
  id,
  link_status,
  waiter_id,
});

describe("chi si può aggiungere a un turno finito", () => {
  const staff = [
    person("anna"),
    person("bruno"),
    person("carla"),
    person("dario", "pending"),
    person("me", "active", "user-me"),
  ];

  it("chi non è sul turno, o aveva rifiutato; non gli inviti in attesa", () => {
    const out = shiftWorkerCandidates(
      staff,
      [
        { venue_member_id: "anna", status: "confirmed" },
        { venue_member_id: "bruno", status: "no_show" },
        { venue_member_id: "carla", status: "declined" },
      ],
      () => false
    );
    expect(out.map((m) => m.id)).toEqual(["carla", "me"]);
  });

  it("un collaboratore non aggiunge sé stesso", () => {
    const out = shiftWorkerCandidates(staff, [], (waiterId) => waiterId === "user-me");
    expect(out.map((m) => m.id)).not.toContain("me");
  });
});

describe("defaultRoleFor", () => {
  const role = (id: string) => ({ role: { id, name: id, sort_order: 0 } });

  it("con una mansione sola è quella, con più resta da scegliere", () => {
    expect(defaultRoleFor({ staff_member_roles: [role("sala")] })).toBe("sala");
    expect(defaultRoleFor({ staff_member_roles: [role("sala"), role("bar")] })).toBeNull();
    expect(defaultRoleFor({ staff_member_roles: [{ role: null }] })).toBeNull();
  });
});
