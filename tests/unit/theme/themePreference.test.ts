import { describe, expect, it } from "vitest";
import {
  parseThemePreference,
  resolveScheme,
  themeHint,
  THEME_OPTIONS,
} from "@/features/appearance/themePreference";

describe("preferenza del tema", () => {
  it("una scelta salvata illeggibile torna ad Automatico", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("Dark")).toBe("system");
  });

  it("una scelta esplicita vince sul sistema", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });

  it("Automatico segue il sistema, e senza sistema è chiaro come i token CSS", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", "unspecified")).toBe("light");
  });

  it("la riga sotto la scelta dice cosa si vede con Automatico", () => {
    expect(themeHint("system", "dark")).toContain("scuro");
    expect(themeHint("system", "light")).toContain("chiaro");
    expect(themeHint("dark", "dark")).not.toContain("adesso");
  });

  it("le tre opzioni, nell'ordine di Impostazioni", () => {
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(["Automatico", "Chiaro", "Scuro"]);
  });
});
