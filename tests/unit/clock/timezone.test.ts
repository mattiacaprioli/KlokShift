import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveRomeLocal,
  romeDateTimeLocal,
  romeFieldToIso,
} from "@/features/clock/timezone";

const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

describe("orari civili italiani ↔ istanti (B07)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("converte un orario normale d'inverno e d'estate", () => {
    expect(resolveRomeLocal("2026-10-04T09:00")).toEqual({ kind: "ok", iso: "2026-10-04T07:00:00.000Z" });
    expect(resolveRomeLocal("2026-01-15T09:00")).toEqual({ kind: "ok", iso: "2026-01-15T08:00:00.000Z" });
  });

  it("non sposta le ore valide attorno ai cambi d'ora (casi riprodotti dall'audit)", () => {
    // Prima del fix: 01:30 del 29/03 tornava 00:30, 01:30 del 25/10 tornava 02:30.
    for (const value of ["2026-03-29T01:30", "2026-10-25T00:30", "2026-10-25T03:30", "2026-03-29T03:00"]) {
      const result = resolveRomeLocal(value);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(romeDateTimeLocal(result.iso)).toBe(value);
    }
    expect(resolveRomeLocal("2026-03-29T01:30")).toEqual({ kind: "ok", iso: "2026-03-29T00:30:00.000Z" });
  });

  it("riconosce l'ora che a marzo non esiste", () => {
    expect(resolveRomeLocal("2026-03-29T02:30")).toEqual({ kind: "skipped" });
    expect(resolveRomeLocal("2026-03-29T02:00")).toEqual({ kind: "skipped" });
  });

  it("riconosce l'ora che a ottobre si ripete, in ordine cronologico", () => {
    expect(resolveRomeLocal("2026-10-25T02:30")).toEqual({
      kind: "ambiguous",
      candidates: ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
    });
  });

  it("gestisce la mezzanotte e il cambio di giorno", () => {
    expect(resolveRomeLocal("2026-12-31T00:00")).toEqual({ kind: "ok", iso: "2026-12-30T23:00:00.000Z" });
    expect(romeDateTimeLocal("2026-12-30T23:00:00.000Z")).toBe("2026-12-31T00:00");
    expect(romeDateTimeLocal("2026-07-01T22:00:00.000Z")).toBe("2026-07-02T00:00");
  });

  it("rifiuta un valore incompleto o impossibile", () => {
    for (const value of ["", "2026-10-04", "2026-10-04T9:00", "2026-02-30T10:00", "2026-10-04T25:00", "abc"]) {
      expect(resolveRomeLocal(value)).toEqual({ kind: "invalid" });
    }
  });

  it("non dipende dal fuso del browser", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(resolveRomeLocal("2026-03-29T01:30")).toEqual({ kind: "ok", iso: "2026-03-29T00:30:00.000Z" });
    expect(romeDateTimeLocal("2026-10-25T00:30:00.000Z")).toBe("2026-10-25T02:30");
  });

  it("calcola la durata reale di un turno a cavallo del cambio d'ora", () => {
    const at = (v: string) => (resolveRomeLocal(v) as { iso: string }).iso;
    expect(hours(at("2026-03-29T01:00"), at("2026-03-29T04:00"))).toBe(2);
    expect(hours(at("2026-10-25T01:00"), at("2026-10-25T04:00"))).toBe(4);
  });
});

describe("campo del form di correzione (B07)", () => {
  it("salva l'istante originale se il campo non è stato toccato, anche nell'ora ripetuta", () => {
    const original = "2026-10-25T01:30:42.000Z"; // la seconda 02:30, con i secondi
    expect(romeFieldToIso(romeDateTimeLocal(original), { originalIso: original })).toEqual({ ok: true, iso: original });
  });

  it("chiede di scegliere per una nuova ora ripetuta e usa la scelta", () => {
    const pending = romeFieldToIso("2026-10-25T02:30");
    expect(pending.ok).toBe(false);
    if (!pending.ok) {
      expect(pending.reason).toBe("ambiguous");
      expect(pending.message).toMatch(/si ripete/);
    }
    expect(romeFieldToIso("2026-10-25T02:30", { ambiguousChoice: 0 })).toEqual({ ok: true, iso: "2026-10-25T00:30:00.000Z" });
    expect(romeFieldToIso("2026-10-25T02:30", { ambiguousChoice: 1 })).toEqual({ ok: true, iso: "2026-10-25T01:30:00.000Z" });
  });

  it("dà un errore in italiano per l'ora inesistente e per il valore non valido", () => {
    const skipped = romeFieldToIso("2026-03-29T02:30");
    expect(skipped).toMatchObject({ ok: false, reason: "skipped" });
    if (!skipped.ok) expect(skipped.message).toMatch(/non esiste/);
    expect(romeFieldToIso("")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("ignora la scelta quando l'ora non è ambigua", () => {
    expect(romeFieldToIso("2026-10-04T09:00", { ambiguousChoice: 1 })).toEqual({ ok: true, iso: "2026-10-04T07:00:00.000Z" });
  });
});
