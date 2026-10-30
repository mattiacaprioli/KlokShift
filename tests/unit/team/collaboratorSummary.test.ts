import { describe, expect, it } from "vitest";
import {
  collaboratorInviteText,
  collaboratorSummary,
} from "@/features/team/collaboratorSummary";
import type { Membership } from "@/features/workspace/types";

const venue = (name: string, closed = false) => ({
  id: name, name, city: null, closed_at: closed ? "2026-10-01T00:00:00Z" : null, logo_url: null, perms: [],
});

function member(over: Partial<Membership> = {}): Membership {
  return {
    member_id: "m", workspace_id: "ws", workspace_name: "Da Mario", plan: "pro",
    authority: "collaborator", status: "active", display_name: "Giulia",
    scope: "selected",
    perms: { shifts: true, staff: false, hours: true, documents: false, venue: false },
    venues: [venue("Milano"), venue("Roma"), venue("Torino", true)],
    works: [],
    ...over,
  };
}

describe("benvenuto del collaboratore", () => {
  it("elenca solo i permessi dati, e comincia dal primo", () => {
    const s = collaboratorSummary(member());
    expect(s.workspaceName).toBe("Da Mario");
    expect(s.can.map((c) => c.label)).toEqual(["Turni", "Ore ed export"]);
    expect(s.start).toEqual({ path: "/planning", label: "Apri i turni" });
  });

  it("dice anche cosa non può fare, così un menu corto non sembra un errore", () => {
    expect(collaboratorSummary(member()).cannot).toEqual(["Team", "Documenti", "Dati della sede"]);
  });

  it("dice le sedi aperte dell'ambito, non quelle chiuse", () => {
    expect(collaboratorSummary(member()).venues).toBe("Le sedi Milano e Roma.");
    expect(collaboratorSummary(member({ venues: [venue("Milano")] })).venues).toBe("La sede Milano.");
    expect(collaboratorSummary(member({ scope: "all" })).venues).toMatch(/Tutte le sedi/);
    expect(collaboratorSummary(member({ venues: [] })).venues).toMatch(/nessuna sede/);
  });

  it("senza permessi non propone una pagina da cui partire", () => {
    const s = collaboratorSummary(member({
      perms: { shifts: false, staff: false, hours: false, documents: false, venue: false },
    }));
    expect(s.can).toEqual([]);
    expect(s.cannot).toHaveLength(5);
    expect(s.start).toBeNull();
    expect(s.ownerKeeps).toMatch(/titolare/);
  });

  it("all'invito dice cosa potrà fare e dove, prima del sì", () => {
    expect(collaboratorInviteText(member())).toBe(
      "Ti ha invitato a collaborare alla gestione. Potrai gestire: Turni, Ore ed export. Le sedi Milano e Roma."
    );
  });
});
