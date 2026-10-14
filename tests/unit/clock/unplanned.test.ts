import { describe, expect, it } from "vitest";
import {
  defaultUnplannedOut,
  formatRomeDay,
  formatUnplannedDuration,
  romeTime,
  timeFromPicker,
  timeToPicker,
  unplannedOutAt,
  validateUnplannedOut,
} from "@/features/clock/unplanned";

// Istanti scritti con l'offset di Roma: il risultato non deve dipendere dal fuso
// della macchina (la CI gira in UTC, vedi tests-timezone-ci).
const rome = (local: string, offset = "+02:00") =>
  new Date(`${local}:00${offset}`).toISOString();
const HOUR = 3_600_000;

describe("uscita di una timbratura senza turno: orario di Roma", () => {
  it("resta nello stesso giorno quando viene dopo l'entrata", () => {
    expect(unplannedOutAt(rome("2026-10-10T09:12"), "17:30")).toEqual({
      ok: true,
      iso: rome("2026-10-10T17:30"),
    });
  });

  it("passa al giorno dopo quando l'ora scelta è prima dell'entrata", () => {
    expect(unplannedOutAt(rome("2026-10-10T22:00"), "02:15")).toEqual({
      ok: true,
      iso: rome("2026-10-11T02:15"),
    });
  });

  it("la stessa ora dell'entrata vale ventiquattro ore dopo, mai zero", () => {
    expect(unplannedOutAt(rome("2026-10-10T09:00"), "09:00")).toEqual({
      ok: true,
      iso: rome("2026-10-11T09:00"),
    });
  });

  it("conta il giorno di Roma, non quello UTC", () => {
    // 23:30 a Roma è ancora il 10 in UTC: le 00:30 sono il giorno dopo a Roma.
    expect(unplannedOutAt(rome("2026-10-10T23:30"), "00:30")).toEqual({
      ok: true,
      iso: rome("2026-10-11T00:30"),
    });
  });

  it("nell'ora ripetuta di ottobre chiede quale delle due", () => {
    const inAt = rome("2026-10-25T01:30");
    const res = unplannedOutAt(inAt, "02:30");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("ambiguous");
    expect(unplannedOutAt(inAt, "02:30", 0)).toEqual({ ok: true, iso: rome("2026-10-25T02:30") });
    expect(unplannedOutAt(inAt, "02:30", 1)).toEqual({
      ok: true,
      iso: rome("2026-10-25T02:30", "+01:00"),
    });
  });

  it("nell'ora ripetuta non chiede se solo la seconda viene dopo l'entrata", () => {
    expect(unplannedOutAt(rome("2026-10-25T02:50"), "02:45")).toEqual({
      ok: true,
      iso: rome("2026-10-25T02:45", "+01:00"),
    });
  });

  it("l'ora saltata di marzo è un errore, non un'ora a caso", () => {
    const res = unplannedOutAt(rome("2026-03-29T01:00", "+01:00"), "02:30");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("skipped");
  });

  it("dopo il salto le 02:30 sono quelle della notte seguente", () => {
    expect(unplannedOutAt(rome("2026-03-29T03:30"), "02:30")).toEqual({
      ok: true,
      iso: rome("2026-03-30T02:30"),
    });
  });

  it("rifiuta un orario malformato", () => {
    const res = unplannedOutAt(rome("2026-10-10T09:00"), "25:00");
    expect(!res.ok && res.reason).toBe("invalid");
  });
});

describe("validazione dell'uscita", () => {
  const inAt = rome("2026-10-10T14:00");
  const now = Date.parse(rome("2026-10-10T22:00"));

  it("accetta un'uscita fra l'entrata e adesso", () => {
    expect(validateUnplannedOut(inAt, rome("2026-10-10T21:30"), now)).toBeNull();
  });

  it("rifiuta un'uscita prima o uguale all'entrata", () => {
    expect(validateUnplannedOut(inAt, inAt, now)).toMatch(/successiva all’entrata/);
  });

  it("rifiuta un'uscita nel futuro", () => {
    expect(validateUnplannedOut(inAt, rome("2026-10-10T22:01"), now)).toMatch(/futuro/);
  });

  it("rifiuta un'uscita oltre 24 ore dall'entrata", () => {
    const later = Date.parse(inAt) + 30 * HOUR;
    expect(validateUnplannedOut(inAt, new Date(later).toISOString(), later)).toMatch(
      /al massimo 24 ore/
    );
  });

  it("accetta esattamente 24 ore, come il server", () => {
    const out = new Date(Date.parse(inAt) + 24 * HOUR).toISOString();
    expect(validateUnplannedOut(inAt, out, Date.parse(inAt) + 30 * HOUR)).toBeNull();
  });
});

describe("uscita proposta", () => {
  it("è adesso per un'entrata recente", () => {
    const inAt = rome("2026-10-10T14:00");
    const now = Date.parse(inAt) + 2 * HOUR;
    expect(defaultUnplannedOut(inAt, now)).toBe(new Date(now).toISOString());
  });

  it("per un'entrata di 30 ore fa è il massimo consentito, e il server la accetta", () => {
    const inAt = rome("2026-10-10T14:00");
    const now = Date.parse(inAt) + 30 * HOUR;
    const out = defaultUnplannedOut(inAt, now);
    expect(out).toBe(rome("2026-10-11T14:00"));
    expect(validateUnplannedOut(inAt, out, now)).toBeNull();
  });
});

describe("anteprima", () => {
  it("scrive la durata in ore e minuti", () => {
    expect(formatUnplannedDuration(rome("2026-10-10T14:00"), rome("2026-10-10T21:30"))).toBe(
      "7 h 30 min"
    );
    expect(formatUnplannedDuration(rome("2026-10-10T14:00"), rome("2026-10-11T02:00"))).toBe(
      "12 h"
    );
    expect(formatUnplannedDuration(rome("2026-10-10T14:00"), rome("2026-10-10T14:45"))).toBe(
      "45 min"
    );
  });

  it("conta i minuti interi, come il turno che nasce", () => {
    const inAt = new Date(Date.parse(rome("2026-10-10T14:00")) + 40_000).toISOString();
    const out = new Date(Date.parse(rome("2026-10-10T21:30")) + 10_000).toISOString();
    expect(formatUnplannedDuration(inAt, out)).toBe("7 h 30 min");
  });

  it("scrive il giorno di Roma", () => {
    expect(formatRomeDay("2026-10-10T12:00:00Z")).toBe("sab 10/10");
    expect(formatRomeDay("2026-10-10T22:30:00Z")).toBe("dom 11/10");
  });
});

describe("selettore d'orario dell'app", () => {
  it("rilegge lo stesso HH:mm che riceve, qualunque sia il fuso del telefono", () => {
    for (const time of ["00:00", "02:30", "09:05", "23:59"]) {
      expect(timeFromPicker(timeToPicker(time))).toBe(time);
    }
  });

  it("parte dall'orario di Roma dell'uscita proposta", () => {
    expect(romeTime(rome("2026-10-11T00:30"))).toBe("00:30");
  });
});
