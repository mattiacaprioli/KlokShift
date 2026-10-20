import { describe, expect, it } from "vitest";
import { documentPaths, fullExportFileName, fullExportFiles, fullExportSchema, safeName, type FullExport } from "../../web/src/export/fullExportFiles";

const data: FullExport = fullExportSchema.parse({
  generated_at: "2026-10-20T15:00:00+00:00",
  workspace: { id: "w", name: "Bar Stagione", created_at: "2026-01-01T10:00:00+00:00" },
  documents_included: true,
  venues: [{ name: "Centro", address: "Via Roma 1", city: "Rieti", created_at: "2026-01-01T10:00:00+00:00", closed_at: null }],
  people: [{ name: "=Mario", email: "m@x.it", phone: null, authority: "none", status: "left", joined_at: "2026-01-02T10:00:00+00:00",
    left_at: "2026-09-30T10:00:00+00:00", contract_hours: 40, contract_period: "week", hr_note: "Nota; con punto e virgola",
    venues: [{ venue: "Centro", employment_type: "fisso", left_at: null, roles: "Sala, Bar" }] }],
  shifts: [{ date: "2026-08-14", venue: "Centro", title: "Cena", start_time: "18:00:00", end_time: "23:30:00",
    break_minutes: 30, break_paid: false, status: "closed", unplanned: false, positions_total: 2, description: null }],
  attendance: [{ date: "2026-08-14", venue: "Centro", shift: "Cena", start_time: "18:00:00", end_time: "23:30:00",
    person: "=Mario", role: "Sala", status: "confirmed", confirmed_at: "2026-08-13T09:00:00+00:00", clock_method: "app",
    clock_in_at: "2026-08-14T16:02:00+00:00", clock_out_at: "2026-08-14T21:31:00+00:00", clock_break_minutes: 30,
    corrected: false, correction_reason: null, worked_hours: "4.98", hours_source: "clock", reviewed_at: null }],
  absences: [{ person: "=Mario", kind: "ferie", start_date: "2026-08-20", end_date: "2026-08-21", start_time: null, end_time: null,
    status: "approved", recognized_minutes: 960, inps_protocol: null, note: null, resolution_note: null,
    created_at: "2026-08-01T09:00:00+00:00" }],
  documents: [
    { person: "=Mario", name: "Contratto", mime_type: "application/pdf", size_bytes: 100, expires_at: "2027-01-01",
      created_at: "2026-01-02T10:00:00+00:00", storage_path: "m1/a.pdf" },
    { person: "=Mario", name: "Contratto", mime_type: "application/pdf", size_bytes: 100, expires_at: null,
      created_at: "2026-02-02T10:00:00+00:00", storage_path: "m1/b.pdf" },
  ],
});

describe("export completo: file del pacchetto", () => {
  const files = fullExportFiles(data);
  it("tutti i file, con BOM per Excel; niente chat", () => {
    expect(Object.keys(files).sort()).toEqual(["assenze.csv", "documenti.csv", "leggimi.txt", "persone.csv", "presenze.csv", "sedi.csv", "turni.csv"]);
    expect(files["turni.csv"].startsWith("﻿Data;Sede;Turno")).toBe(true);
    expect(files["leggimi.txt"]).toContain("Le chat non sono incluse.");
  });
  it("date italiane, ora di Roma, decimali con la virgola", () => {
    expect(files["turni.csv"]).toContain("14/08/2026;Centro;Cena;18:00;23:30;30;No;Completo");
    expect(files["presenze.csv"]).toContain("14/08/2026 18:02");
    expect(files["presenze.csv"]).toContain(";4,98;Timbratura;");
    expect(files["assenze.csv"]).toContain("Ferie;20/08/2026;21/08/2026;;;Approvata;16;");
  });
  it("testo protetto da formule e punto e virgola", () => {
    expect(files["persone.csv"]).toContain("'=Mario");
    expect(files["persone.csv"]).toContain('"Nota; con punto e virgola"');
    expect(files["persone.csv"]).toContain("Uscito");
  });
  it("documenti per persona, nomi doppi resi unici, file mancanti segnati", () => {
    expect(documentPaths(data.documents!)).toEqual(["documenti/=Mario/Contratto.pdf", "documenti/=Mario/Contratto (2).pdf"]);
    expect(fullExportFiles(data, ["m1/b.pdf"])["documenti.csv"]).toContain("Non scaricato: riprova l'export");
  });
  it("senza permesso sui documenti: niente elenco, lo dice il leggimi", () => {
    const noDocs = fullExportFiles({ ...data, documents_included: false, documents: null });
    expect(noDocs["documenti.csv"]).toBeUndefined();
    expect(noDocs["leggimi.txt"]).toContain("Documenti non inclusi");
  });
  it("nomi di file sicuri", () => {
    expect(safeName('a/b:c*?"<>|d')).toBe("a_b_c_d");
    expect(fullExportFileName("Bar/Stagione", new Date("2026-10-20T22:30:00Z"))).toBe("Bar_Stagione - export completo 2026-10-21.zip");
  });
});
