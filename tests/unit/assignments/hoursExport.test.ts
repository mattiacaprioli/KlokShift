import { describe, expect, it } from "vitest";
import { exportAvailability } from "@/features/assignments/monthlyReport";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import type { SurchargeRow } from "@/features/assignments/surcharges";
import {
  absencesFileName,
  buildAbsencesCsv,
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";

function person(extra: Partial<PersonHours> = {}): PersonHours {
  return {
    person_id: "p", person_name: "Anna", roles: "Sala", shifts_count: 1,
    hours: 8, planned_hours: 8, to_review_count: 0, proposed_hours: 0, untracked_hours: 0,
    paid_break_hours: 0, unpaid_break_hours: 0, venues: [], ...extra,
  };
}

function absence(extra: Partial<AbsenceSummaryRow> = {}): AbsenceSummaryRow {
  return {
    person_id: "a", person_name: "Marco", ferie_days: 1, permesso_days: 0,
    permesso_hours: 0, malattia_days: 0, ferie_hours: 8, malattia_hours: 0,
    permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null, missing_certificates: 0, ...extra,
  };
}

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("disponibilità degli export del mese (B06)", () => {
  const ready = { hoursReady: true, absencesReady: true, reportRows: 2, absenceRows: 1 };

  it("non esporta il mensile con le ore ancora in arrivo o in errore", () => {
    expect(exportAvailability({ ...ready, hoursReady: false })).toEqual({ monthly: false, absences: true });
  });

  it("non esporta nulla con le assenze ancora in arrivo o in errore", () => {
    expect(exportAvailability({ ...ready, absencesReady: false })).toEqual({ monthly: false, absences: false });
  });

  it("esporta il mensile con le sole assenze se le ore sono caricate e vuote", () => {
    expect(exportAvailability({ ...ready, reportRows: 1 })).toEqual({ monthly: true, absences: true });
  });

  it("non esporta un mese vuoto", () => {
    expect(exportAvailability({ ...ready, reportRows: 0, absenceRows: 0 })).toEqual({
      monthly: false,
      absences: false,
    });
  });
});

describe("pausa nel PDF", () => {
  it("dice quanta pausa è inclusa e quanta esclusa, senza sommarla", () => {
    const html = buildHoursHtml(
      "Osteria",
      "ottobre 2026",
      [person({ hours: 7.5, paid_break_hours: 1, unpaid_break_hours: 0.5 })],
      7.5
    );
    expect(html).toContain("1 h retribuita (inclusa) · 0,5 h non retribuita (esclusa)");
    expect(html).toContain('<td class="n">7,5</td>');
  });
});

describe("anomalie nel PDF (B06)", () => {
  it("segnala le timbrature da verificare come il CSV, senza contarle nel lavorato", () => {
    const pending = person({ hours: 0, shifts_count: 1, to_review_count: 2, proposed_hours: 8 });
    const html = buildHoursHtml("Osteria", "ottobre 2026", [pending], 0);
    expect(html).toContain("2 turni da verificare");
    expect(html).not.toMatch(/<td class="n">—<\/td><\/tr><\/tbody>/);
    expect(lines(buildHoursCsv([pending]))[1].split(";")).toEqual([
      "Anna", "Sala", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "Da verificare",
    ]);
  });

  it("usa il singolare per un turno solo e unisce le altre anomalie", () => {
    const html = buildHoursHtml("Osteria", "ottobre 2026", [person({ to_review_count: 1, untracked_hours: 2 })], 8);
    expect(html).toContain("2 h senza timbratura · 1 turno da verificare");
  });
});

describe("celle CSV (B06)", () => {
  it("neutralizza le formule nelle celle di testo e lascia i numeri numerici", () => {
    const people = ["=1+1", "+39 333", "-2", "@SUM(A1)", "\tTab", "\rCR"].map((name, i) =>
      person({ person_id: String(i), person_name: name, roles: "=HYPERLINK(\"x\")", hours: 12.5 })
    );
    const csv = buildHoursCsv(people);
    const cells = lines(csv).slice(1).map((l) => l.split(";").slice(0, 4));
    expect(cells[0]).toEqual(["'=1+1", `"'=HYPERLINK(""x"")"`, "1", "12,5"]);
    expect(cells[1][0]).toBe("'+39 333");
    expect(cells[2][0]).toBe("'-2");
    expect(cells[3][0]).toBe("'@SUM(A1)");
    expect(cells[4][0]).toBe("'\tTab");
    expect(csv).toContain(`"'\rCR"`);
  });

  it("quota virgolette, punto e virgola e a capo, e conserva gli accenti", () => {
    const csv = buildHoursCsv([
      person({ person_name: 'Niccolò "Nico" Rè', roles: "Sala; Bar\nCucina", hours: 7.25 }),
    ]);
    expect(csv).toContain('\r\n"Niccolò ""Nico"" Rè";');
    expect(csv).toContain('"Sala; Bar\nCucina"');
    expect(csv).toContain(";7,25;");
  });

  it("arrotonda le ore al centesimo e toglie gli zeri finali", () => {
    const csv = buildHoursCsv([person({ person_name: "Anna", hours: 7.8333 })]);
    expect(lines(csv)[1].split(";")[3]).toBe("7,83");
    expect(buildHoursCsv([person({ hours: 7.5 })])).toContain(";7,5;");
    expect(buildHoursCsv([person({ hours: 8 })])).toContain(";8;");
  });

  it("applica la stessa regola al CSV delle assenze", () => {
    const csv = buildAbsencesCsv([absence({ person_name: "=cmd", inps_protocols: "-123; 456" })]);
    expect(lines(csv)[1]).toBe(`'=cmd;1;0;0;0;"'-123; 456"`);
  });
});

describe("export di una parte dell'organico", () => {
  it("il PDF dice chi è incluso, e non lo dice per l'azienda intera", () => {
    const anna = person({ person_name: "Anna <Rossi>" });
    const filtered = buildHoursHtml("Osteria", "1–15 ottobre 2026", [anna], 8, [], ["Anna <Rossi>"]);
    expect(filtered).toContain("Osteria · 1–15 ottobre 2026");
    expect(filtered).toContain("Persone incluse: Anna &lt;Rossi&gt;");
    expect(buildHoursHtml("Osteria", "Ottobre 2026", [anna], 8)).not.toContain("Persone incluse");
  });

  it("il nome file porta il periodo e la persona, o «selezione» per un gruppo", () => {
    expect(hoursFileName("Osteria", "1–15 ottobre 2026", "csv")).toBe("ore-osteria-1-15-ottobre-2026.csv");
    expect(hoursFileName("Osteria", "Ottobre 2026", "csv", ["Niccolò Bianchi"])).toBe("ore-osteria-ottobre-2026-niccolo-bianchi.csv");
    expect(absencesFileName("Osteria", "Ottobre 2026", "csv", ["Anna", "Bruno"])).toBe("assenze-osteria-ottobre-2026-selezione.csv");
  });
});

describe("codici per il consulente nel mensile e nelle assenze", () => {
  const codes = {
    codes: { work: "01", ferie: "FE", malattia: "MAL" },
    matricole: new Map([["p", "A12"], ["a", "M9"]]),
  };

  it("mette la matricola dopo il nome e i codici nelle intestazioni", () => {
    const out = lines(buildHoursCsv([person()], [], codes));
    expect(out[0]).toBe(
      "Nome;Matricola;Ruolo;Turni;Ore lavorate effettive (01);Di cui pausa retribuita;Pausa non retribuita esclusa;Ferie (FE) - ore riconosciute;MAL/Malattia (MAL) - ore riconosciute;Permessi - ore riconosciute;Ore di assenza giustificata;Totale ore coperte;Ore di assenza da verificare;Ore senza timbratura escluse;Stato"
    );
    expect(out[1].startsWith("Anna;A12;Sala;1;8;")).toBe(true);
  });

  it("un codice con il punto e virgola non sposta le colonne", () => {
    const odd = { codes: { work: 'A;"B' }, matricole: new Map<string, string>() };
    const header = lines(buildHoursCsv([person()], [], odd))[0];
    expect(header).toContain(';"Ore lavorate effettive (A;""B)";');
    expect(header.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(15);
  });

  it("senza codici il mensile è quello di sempre", () => {
    expect(buildHoursCsv([person()], [], undefined)).toBe(buildHoursCsv([person()]));
  });

  it("mette la matricola nel CSV delle assenze", () => {
    const out = lines(buildAbsencesCsv([absence()], codes));
    expect(out[0].startsWith("Nome;Matricola;Ferie (giorni di calendario)")).toBe(true);
    expect(out[1]).toBe("Marco;M9;1;0;0;0;");
  });
});

describe("maggiorazioni nel mensile e nel PDF", () => {
  const sur = (extra: Partial<SurchargeRow> = {}): SurchargeRow => ({
    person_id: "p", person_name: "Anna", date: "2026-10-11", venue_name: "Centro", title: "Sera",
    clock_in: "18:00", clock_out: "02:00", kind: "night", percentage: 20, hours: 1.88, ...extra,
  });
  const both = [sur({ kind: "sunday", percentage: 30, hours: 5.62 }), sur()];

  it("una colonna «di cui» per voce dopo le pause", () => {
    const out = lines(buildHoursCsv([person()], [], undefined, both));
    expect(out[0]).toContain(";Pausa non retribuita esclusa;Di cui notturno +20%;Di cui domenica +30%;Ferie");
    expect(out[1]).toContain(";1,88;5,62;");
  });

  it("con il codice della voce fra parentesi", () => {
    const codes = { codes: { night: "NOT" }, matricole: new Map<string, string>() };
    expect(lines(buildHoursCsv([person()], [], codes, both))[0]).toContain(";Di cui notturno +20% (NOT);");
  });

  it("due percentuali della stessa voce: due colonne, stesso codice", () => {
    const codes = { codes: { night: "NOT" }, matricole: new Map<string, string>() };
    const header = lines(buildHoursCsv([person()], [], codes, [sur(), sur({ percentage: 25, hours: 2, date: "2026-11-02" })]))[0];
    expect(header).toContain(";Di cui notturno +20% (NOT);Di cui notturno +25% (NOT);");
  });

  it("chi non ha maggiorazioni ha zero", () => {
    const out = lines(buildHoursCsv([person(), person({ person_id: "q", person_name: "Bea" })], [], undefined, both));
    expect(out[0].split(";").slice(6, 8)).toEqual(["Di cui notturno +20%", "Di cui domenica +30%"]);
    expect(out[2].split(";").slice(6, 8)).toEqual(["0", "0"]);
  });

  it("senza maggiorazioni il mensile è quello di sempre", () => {
    expect(buildHoursCsv([person()], [], undefined, [])).toBe(buildHoursCsv([person()]));
    expect(buildHoursCsv([person()], [], undefined, undefined)).toBe(buildHoursCsv([person()]));
  });

  it("il PDF ha le colonne «di cui» e il totale", () => {
    const html = buildHoursHtml("Osteria", "ottobre 2026", [person()], 8, [], [], undefined, both);
    expect(html).toContain("Di cui notturno +20%");
    expect(html).toContain("Di cui domenica +30%");
    expect(html).toContain(">5,62<");
    expect(buildHoursHtml("Osteria", "ottobre 2026", [person()], 8, [], [], undefined, [])).toBe(
      buildHoursHtml("Osteria", "ottobre 2026", [person()], 8)
    );
  });
});
