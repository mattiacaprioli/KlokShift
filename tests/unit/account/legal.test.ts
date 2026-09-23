import { describe, expect, it } from "vitest";

import {
  DEFAULT_SITE_URL,
  legalUrlsFor,
} from "@/features/account/legal";

describe("legalUrlsFor", () => {
  it("usa il dominio pubblico quando la build non configura il sito", () => {
    expect(legalUrlsFor()).toEqual({
      privacy: `${DEFAULT_SITE_URL}/privacy.html`,
      accountDeletion: `${DEFAULT_SITE_URL}/elimina-account.html`,
    });
  });

  it("normalizza spazi e slash finali della configurazione", () => {
    expect(legalUrlsFor("  https://example.test///  ")).toEqual({
      privacy: "https://example.test/privacy.html",
      accountDeletion: "https://example.test/elimina-account.html",
    });
  });

  it("non accetta una stringa vuota come dominio configurato", () => {
    expect(legalUrlsFor("   ").privacy).toBe(
      "https://klokshift.com/privacy.html"
    );
  });
});
