import { describe, expect, it } from "vitest";
import { navHidden } from "../../../web-site/src/ui/navScroll";

/*
 * La barra in alto si toglie di mezzo quando si scende e torna appena si
 * risale. Non si nasconde mai con il menu aperto o con il focus dentro (chi
 * naviga da tastiera perderebbe di vista dove si trova), né in cima alla pagina.
 */
const base = { prevY: 500, y: 500, wasHidden: false, menuOpen: false, focusInside: false, anchoring: false };

describe("barra che si nasconde scorrendo", () => {
  it("in cima alla pagina resta visibile anche scendendo", () => {
    expect(navHidden({ ...base, prevY: 30, y: 40 })).toBe(false);
  });

  it("scendendo oltre la soglia si nasconde", () => {
    expect(navHidden({ ...base, prevY: 500, y: 510 })).toBe(true);
  });

  it("risalendo torna subito", () => {
    expect(navHidden({ ...base, prevY: 510, y: 500, wasHidden: true })).toBe(false);
  });

  it("un tremolio di pochi pixel non la fa lampeggiare", () => {
    expect(navHidden({ ...base, prevY: 500, y: 502, wasHidden: true })).toBe(true);
    expect(navHidden({ ...base, prevY: 502, y: 500, wasHidden: false })).toBe(false);
  });

  it("con il menu aperto non si nasconde", () => {
    expect(navHidden({ ...base, prevY: 500, y: 600, menuOpen: true })).toBe(false);
  });

  it("con il focus dentro non si nasconde", () => {
    expect(navHidden({ ...base, prevY: 500, y: 600, focusInside: true })).toBe(false);
  });

  it("mentre la pagina scorre verso un link interno resta visibile", () => {
    // Dopo «Prezzi» la sezione deve cominciare sotto la barra, non sotto il vuoto.
    expect(navHidden({ ...base, prevY: 500, y: 900, anchoring: true })).toBe(false);
  });
});
