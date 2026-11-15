import { describe, expect, it } from "vitest";
import type { FirstStep, FirstStepId, FirstStepStatus } from "@/features/onboarding/firstSteps";
import { emptyWeekGuide, firstWeekStart } from "@/features/onboarding/firstWeek";

/*
 * La prima settimana di chi non ha ancora nessun turno: quale si apre e cosa
 * gli si propone dentro. Il 15/11/2026, una domenica, la settimana in corso
 * mostrava sei giorni passati su sette, tutti con «+ Già fatto».
 */
describe("quale settimana si apre la prima volta", () => {
  it("dal lunedì al venerdì resta la settimana in corso", () => {
    expect(firstWeekStart("2026-11-09")).toBe("2026-11-09"); // lunedì
    expect(firstWeekStart("2026-11-13")).toBe("2026-11-09"); // venerdì
  });

  it("sabato e domenica si apre la prossima: è quella da preparare", () => {
    expect(firstWeekStart("2026-11-14")).toBe("2026-11-16"); // sabato
    expect(firstWeekStart("2026-11-15")).toBe("2026-11-16"); // domenica
  });

  it("a cavallo di mese e d'anno", () => {
    expect(firstWeekStart("2026-11-29")).toBe("2026-11-30"); // domenica
    expect(firstWeekStart("2027-01-02")).toBe("2027-01-04"); // sabato
  });
});

const step = (id: FirstStepId, status: FirstStepStatus): FirstStep => ({
  id,
  status,
  title: id,
  detail: "",
  cta: "",
});

const steps = (s: Partial<Record<FirstStepId, FirstStepStatus>>) =>
  (["trial", "roles", "people", "shift", "team"] as const).map((id) =>
    step(id, s[id] ?? "todo")
  );

describe("cosa propone la settimana vuota", () => {
  it("senza ruoli, prima i ruoli", () => {
    expect(emptyWeekGuide(steps({ trial: "done" }))).toBe("roles");
  });

  it("con i ruoli ma senza persone, le persone", () => {
    expect(emptyWeekGuide(steps({ trial: "done", roles: "done" }))).toBe("people");
  });

  it("con ruoli e persone, il primo turno", () => {
    expect(emptyWeekGuide(steps({ trial: "done", roles: "done", people: "done" }))).toBe("shift");
  });

  it("le persone senza ruoli bastano per il turno: si propone ancora il ruolo", () => {
    // Il turno chiede un ruolo: senza, il form non sa chi cercare.
    expect(emptyWeekGuide(steps({ trial: "done", people: "done" }))).toBe("roles");
  });

  it("c'è già un turno: niente guida", () => {
    expect(emptyWeekGuide(steps({ trial: "done", roles: "done", people: "done", shift: "done" }))).toBeNull();
    // Anche se mancano ruoli o persone: chi ha già turni sa dove mettere le mani.
    expect(emptyWeekGuide(steps({ trial: "done", shift: "done" }))).toBeNull();
  });

  it("prova non avviata: niente guida, i turni sono ancora chiusi", () => {
    expect(
      emptyWeekGuide(steps({ trial: "todo", roles: "locked", people: "locked", shift: "locked" }))
    ).toBeNull();
  });
});
