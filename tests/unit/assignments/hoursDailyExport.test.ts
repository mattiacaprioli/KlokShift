import { describe, expect, it } from "vitest";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import {
  buildDailyCsv,
  buildHoursHtml,
  buildTimesheetHtml,
  dailyFileName,
} from "@/lib/exportBuilders";

function row(extra: Partial<HoursDailyRow> = {}): HoursDailyRow {
  return {
    person_id: "p", person_name: "Anna", date: "2026-11-05", kind: "work",
    venue_name: "Centro", title: "Sala", clock_in: "09:00", clock_out: "17:00",
    break_minutes: 30, break_paid: false, hours: 7.5, note: null, ...extra,
  };
}

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("buildDailyCsv", () => {
  it("ha BOM e intestazione esatta", () => {
    const csv = buildDailyCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Data;Persona;Sede;Turno;Causale;Entrata;Uscita;Pausa (min);Pausa retribuita;Ore;Note"
    );
  });

  it("due turni lo stesso giorno restano due righe", () => {
    const l = lines(buildDailyCsv([row(), row({ title: "Cena", hours: 3 })]));
    expect(l).toHaveLength(3);
    expect(l[1]).toBe("05/11/2026;Anna;Centro;Sala;Lavoro;09:00;17:00;30;No;7,5;");
  });

  it("to_fix: nota col motivo e ore vuote", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "to_fix", note: "not_clocked", hours: null, clock_in: null, clock_out: null, break_minutes: null, break_paid: null }),
    ]));
    expect(l[1]).toBe("05/11/2026;Anna;Centro;Sala;Da verificare;;;;;;Non ha timbrato");
  });

  it("ferie senza ore: ore vuote", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "ferie", venue_name: null, title: null, clock_in: null, clock_out: null, break_minutes: null, break_paid: null, hours: null }),
    ]));
    expect(l[1]).toBe("05/11/2026;Anna;;;Ferie;;;;;;");
  });

  it("note di conflitto e di permesso a ore", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "ferie", note: "conflict" }),
      row({ kind: "permesso", note: "hourly:15:00-17:00" }),
    ]));
    expect(l[1].endsWith(";Da verificare")).toBe(true);
    expect(l[2].endsWith(";Dalle 15:00 alle 17:00")).toBe(true);
  });

  it("protegge le formule e usa virgola decimale", () => {
    const l = lines(buildDailyCsv([row({ person_name: "=SOMMA(A1)", hours: 7.83 })]));
    expect(l[1]).toContain(";'=SOMMA(A1);");
    expect(l[1]).toContain(";7,83;");
  });
});

describe("dailyFileName", () => {
  it("usa il prefisso ore-giornaliere", () => {
    expect(dailyFileName("Osteria", "Novembre 2026", "csv")).toBe(
      "ore-giornaliere-osteria-novembre-2026.csv"
    );
  });
});

describe("buildTimesheetHtml (cartellino)", () => {
  const nov = { start: "2026-11-01", end: "2026-12-01" };

  it("somma le ore work dello stesso giorno in una casella", () => {
    const html = buildTimesheetHtml(
      [row({ hours: 4 }), row({ title: "Cena", hours: 4 })],
      nov
    );
    expect(html).toContain('<td class="d">8</td>');
    expect(html).toContain("Presenze · novembre 2026");
  });

  it("un periodo a cavallo di due mesi dà due tabelle coi propri totali", () => {
    const html = buildTimesheetHtml(
      [row({ date: "2026-10-30", hours: 6 }), row({ date: "2026-11-02", hours: 3 })],
      { start: "2026-10-25", end: "2026-11-06" }
    );
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain("Presenze · ottobre 2026");
    expect(html).toContain("Presenze · novembre 2026");
    expect(html).toContain('<td class="t">6</td>');
    expect(html).toContain('<td class="t">3</td>');
    expect(html.match(/page-break-before: always/g)!.length).toBeGreaterThanOrEqual(1);
  });

  it("to_fix dà «?» e non entra nel totale Lavoro", () => {
    const html = buildTimesheetHtml(
      [row({ hours: 4 }), row({ date: "2026-11-06", kind: "to_fix", hours: null, note: "not_clocked" })],
      nov
    );
    expect(html).toContain('<td class="d">?</td>');
    expect(html).toContain('<td class="t">4</td>');
  });

  it("lavoro e to_fix lo stesso giorno: ore e «?», totale Lavoro = ore visibili", () => {
    const html = buildTimesheetHtml(
      [row({ hours: 4 }), row({ kind: "to_fix", hours: null, note: "not_clocked" })],
      nov
    );
    expect(html).toContain('<td class="d">4<br><small>?</small></td>');
    expect(html).toContain('<td class="t">4</td>');
  });

  it("sabato con classe we", () => {
    const html = buildTimesheetHtml([row()], nov);
    expect(html).toMatch(/<th class="we">S<br>7<\/th>/);
    expect(html).toMatch(/<th>G<br>5<\/th>/);
  });

  it("chi ha righe solo a ottobre non compare a novembre", () => {
    const html = buildTimesheetHtml(
      [row({ person_name: "Anna" }), row({ person_id: "b", person_name: "Bruno", date: "2026-10-28" })],
      { start: "2026-10-25", end: "2026-11-06" }
    );
    const [ott, novTable] = html.split("Presenze · novembre 2026");
    expect(ott).toContain("Bruno");
    expect(novTable).not.toContain("Bruno");
  });

  it("assenze: F, P, M e conflitto", () => {
    const base = { clock_in: null, clock_out: null, break_minutes: null, break_paid: null, venue_name: null, title: null };
    const html = buildTimesheetHtml(
      [
        row({ ...base, kind: "ferie", hours: 8, date: "2026-11-02" }),
        row({ ...base, kind: "malattia", hours: null, date: "2026-11-03" }),
        row({ ...base, kind: "permesso", hours: 2, date: "2026-11-04", note: "hourly:15:00-17:00" }),
        row({ ...base, kind: "ferie", hours: null, date: "2026-11-05", note: "conflict" }),
      ],
      nov
    );
    expect(html).toContain('<td class="d">F<br><small>8</small></td>');
    expect(html).toContain('<td class="d">M</td>');
    expect(html).toContain('<td class="d">P<br><small>2</small></td>');
    expect(html).toContain('<td class="d">?</td>');
    expect(html).toContain("1 gg");
  });

  describe("casella del giorno: nessuna informazione persa", () => {
    const base = { clock_in: null, clock_out: null, break_minutes: null, break_paid: null, venue_name: null, title: null };
    const abs = (kind: HoursDailyRow["kind"], hours: number | null, extra: Partial<HoursDailyRow> = {}) =>
      row({ ...base, kind, hours, ...extra });

    it("to_fix + ferie con 8 h riconosciute: F 8 e «?»", () => {
      const html = buildTimesheetHtml(
        [row({ kind: "to_fix", hours: null, note: "not_clocked" }), abs("ferie", 8)],
        nov
      );
      expect(html).toContain('<td class="d">F 8<br><small>?</small></td>');
    });

    it("lavoro 6 + ferie senza credito: 6 e F", () => {
      const html = buildTimesheetHtml([row({ hours: 6 }), abs("ferie", null)], nov);
      expect(html).toContain('<td class="d">6<br><small>F</small></td>');
    });

    it("due permessi orari lo stesso giorno: P 3", () => {
      const html = buildTimesheetHtml(
        [abs("permesso", 2, { note: "hourly:08:00-10:00" }), abs("permesso", 1, { note: "hourly:15:00-16:00" })],
        nov
      );
      expect(html).toContain('<td class="d">P<br><small>3</small></td>');
    });

    it("lavoro 4 + permesso 2 + to_fix: 4, P 2 e «?»", () => {
      const html = buildTimesheetHtml(
        [row({ hours: 4 }), abs("permesso", 2, { note: "hourly:15:00-17:00" }), row({ kind: "to_fix", hours: null, note: "not_clocked" })],
        nov
      );
      expect(html).toContain('<td class="d">4<br><small>P 2 ?</small></td>');
    });

    it("malattia con ore e giorni senza ore: il totale li mostra entrambi", () => {
      const html = buildTimesheetHtml(
        [abs("malattia", 12, { date: "2026-11-02" }), abs("malattia", null, { date: "2026-11-03" }), abs("malattia", null, { date: "2026-11-04" })],
        nov
      );
      expect(html).toContain('<td class="t">12 + 2 gg</td>');
    });
  });

  it("il nome passa da escapeHtml", () => {
    const html = buildTimesheetHtml([row({ person_name: "<script>" })], nov);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("buildHoursHtml senza timesheet non ha il cartellino; con timesheet sì", () => {
    const without = buildHoursHtml("Osteria", "novembre 2026", [], 0);
    expect(without).not.toContain("Presenze ·");
    expect(buildHoursHtml("Osteria", "novembre 2026", [], 0, [], [], undefined)).toBe(without);
    const withTs = buildHoursHtml("Osteria", "novembre 2026", [], 0, [], [], {
      rows: [row()], ...nov,
    });
    expect(withTs).toContain("Presenze · novembre 2026");
  });
});

describe("buildDailyCsv con i codici per il consulente", () => {
  const codes = {
    codes: { company: "AZ1", work: "01", ferie: "FE" },
    matricole: new Map([["p", "A12"], ["q", "=B7"]]),
  };

  it("mette codice azienda, matricola e codice causale in testa", () => {
    const out = lines(buildDailyCsv([
      row(),
      row({ kind: "ferie", clock_in: null, clock_out: null, break_minutes: null, break_paid: null, hours: 8, venue_name: null, title: null }),
      row({ kind: "to_fix", hours: null, note: "not_clocked" }),
      row({ person_id: "x", person_name: "Senza", kind: "malattia", clock_in: null, clock_out: null, break_minutes: null, break_paid: null, hours: null, venue_name: null, title: null }),
    ], codes));
    expect(out[0]).toBe(
      "Codice azienda;Matricola;Codice causale;Data;Persona;Sede;Turno;Causale;Entrata;Uscita;Pausa (min);Pausa retribuita;Ore;Note"
    );
    expect(out[1]).toBe("AZ1;A12;01;05/11/2026;Anna;Centro;Sala;Lavoro;09:00;17:00;30;No;7,5;");
    expect(out[2]).toBe("AZ1;A12;FE;05/11/2026;Anna;;;Ferie;;;;;8;");
    expect(out[3]).toBe("AZ1;A12;;05/11/2026;Anna;Centro;Sala;Da verificare;09:00;17:00;30;No;;Non ha timbrato");
    expect(out[4]).toBe("AZ1;;;05/11/2026;Senza;;;Malattia;;;;;;");
  });

  it("protegge una matricola che sembra una formula", () => {
    expect(lines(buildDailyCsv([row({ person_id: "q" })], codes))[1].split(";")[1]).toBe("'=B7");
  });

  it("senza codici l'output è quello di sempre", () => {
    expect(buildDailyCsv([row()], undefined)).toBe(buildDailyCsv([row()]));
  });
});
