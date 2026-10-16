import { describe, expect, it } from "vitest";

import {
  applicableRoleTargets,
  findTemplateByName,
  parseRoleTargets,
  templateFromShift,
} from "@/features/shiftTemplates/template";

describe("templateFromShift", () => {
  const shift = {
    title: "  Cena  ",
    start_time: "18:00:00",
    end_time: "23:30:00",
    break_minutes: 30,
    description: "  ",
    require_confirmation: true,
  };

  it("ricorda orari in HH:MM, pausa, conferma e il titolo come nome", () => {
    const t = templateFromShift(shift, []);
    expect(t.name).toBe("Cena");
    expect(t.start_time).toBe("18:00");
    expect(t.end_time).toBe("23:30");
    expect(t.break_minutes).toBe(30);
    expect(t.require_confirmation).toBe(true);
  });

  it("note vuote diventano null", () => {
    expect(templateFromShift(shift, []).description).toBeNull();
    expect(
      templateFromShift({ ...shift, description: " Divisa nera " }, []).description
    ).toBe("Divisa nera");
  });

  it("tiene solo i fabbisogni con almeno una persona", () => {
    const t = templateFromShift(shift, [
      { role_id: "sala", count: 3 },
      { role_id: "bar", count: 0 },
    ]);
    expect(t.role_targets).toEqual([{ role_id: "sala", count: 3 }]);
  });

  it("il nome proposto non supera il limite del DB", () => {
    const t = templateFromShift({ ...shift, title: "x".repeat(80) }, []);
    expect(t.name).toHaveLength(60);
  });
});

describe("applicableRoleTargets", () => {
  it("scarta i ruoli che la sede non assegna più", () => {
    expect(
      applicableRoleTargets(
        [
          { role_id: "sala", count: 2 },
          { role_id: "archiviato", count: 1 },
        ],
        [{ id: "sala" }, { id: "bar" }]
      )
    ).toEqual([{ role_id: "sala", count: 2 }]);
  });
});

describe("findTemplateByName", () => {
  const templates = [{ name: "Cena" }, { name: "Pranzo sala" }];

  it("confronta senza maiuscole e spazi ai bordi, come la RPC", () => {
    expect(findTemplateByName(templates, "  cena ")).toBe(templates[0]);
    expect(findTemplateByName(templates, "PRANZO SALA")).toBe(templates[1]);
  });

  it("nessun nome, nessun modello", () => {
    expect(findTemplateByName(templates, "  ")).toBeUndefined();
    expect(findTemplateByName(templates, "Colazione")).toBeUndefined();
  });
});

describe("parseRoleTargets", () => {
  it("tiene solo le voci ben fatte", () => {
    expect(
      parseRoleTargets([
        { role_id: "sala", count: 2 },
        { role_id: "bar", count: 0 },
        { count: 1 },
        "rumore",
        null,
      ])
    ).toEqual([{ role_id: "sala", count: 2 }]);
    expect(parseRoleTargets({ role_id: "sala" })).toEqual([]);
  });
});
