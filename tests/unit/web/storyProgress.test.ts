import { describe, expect, it } from "vitest";
import { activeStep, visualMode } from "../../../web-site/src/story/progress";

/*
 * Quale dei quattro passi della storia è attivo, dato quanto della sezione è
 * stato scorso (0–1). Gli estremi contano: Motion può dare valori appena fuori
 * da 0–1 durante un salto da ancora, e mai un passo inesistente.
 */
describe("passo attivo della storia", () => {
  // -1 = la storia non è ancora arrivata al centro dello schermo: l'oggetto
  // aspetta, così il primo momento (bozza → pubblicata) non si consuma
  // mentre si legge ancora l'apertura.
  it.each([
    [0, -1],
    [0.01, 0],
    [0.24, 0],
    [0.25, 1],
    [0.5, 2],
    [0.999, 3],
    [1, 3],
    [-0.1, -1],
    [1.5, 3],
    [Number.NaN, -1],
  ])("activeStep(%s, 4) = %s", (progress, step) => {
    expect(activeStep(progress, 4)).toBe(step);
  });
});

describe("modo dell'oggetto della storia", () => {
  it("nei passi in colonna mostra lo stato finale", () => {
    expect(visualMode({ still: true, reduce: false, started: true })).toBe("final");
  });

  it("con reduced motion mostra lo stato finale", () => {
    expect(visualMode({ still: false, reduce: true, started: false })).toBe("final");
    expect(visualMode({ still: false, reduce: true, started: true })).toBe("final");
  });

  it("prima che la storia arrivi aspetta, senza timer", () => {
    expect(visualMode({ still: false, reduce: false, started: false })).toBe("paused");
  });

  it("quando la storia è in vista si anima", () => {
    expect(visualMode({ still: false, reduce: false, started: true })).toBe("live");
  });
});
