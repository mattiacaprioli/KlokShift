import { describe, expect, it } from "vitest";

import { menuPlacement } from "../../../web/src/ui/menuPlacement";

describe("menuPlacement", () => {
  it("apre sotto quando c'è spazio", () => {
    expect(menuPlacement({ top: 100, bottom: 140 }, 900, 120)).toEqual({ top: 148, maxHeight: 744, above: false });
  });

  it("apre sopra quando il controllo è in fondo alla finestra", () => {
    // Il caso della pagina Piano: Select a 860–900 px in una finestra alta 900.
    expect(menuPlacement({ top: 860, bottom: 900 }, 900, 120)).toEqual({ top: 732, maxHeight: 120, above: true });
  });

  it("sopra non supera lo spazio che c'è", () => {
    expect(menuPlacement({ top: 100, bottom: 140 }, 160, 300)).toEqual({ top: 8, maxHeight: 84, above: true });
  });

  it("resta sotto se sotto c'è più spazio, anche se poco", () => {
    expect(menuPlacement({ top: 40, bottom: 80 }, 150, 200)).toEqual({ top: 88, maxHeight: 54, above: false });
  });
});
