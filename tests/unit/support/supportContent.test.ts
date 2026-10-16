import { describe, expect, it } from "vitest";

import {
  SUPPORT_DATA_NOTE,
  SUPPORT_FAQ,
  faqFor,
  supportMailto,
  supportScopeNote,
} from "@/features/support/supportContent";

describe("supportMailto", () => {
  it("scrive all'indirizzo dato, con oggetto e contesto codificati", () => {
    const url = supportMailto("aiuto@example.test", {
      surface: "App iOS 1.2.0",
      workspace: { id: "ws-1", name: "Da Buffa & C." },
    });
    const [target, query] = url.split("?");
    expect(target).toBe("mailto:aiuto@example.test");

    const params = new URLSearchParams(query);
    expect(params.get("subject")).toBe("Assistenza KlokShift");
    const body = params.get("body") ?? "";
    expect(body).toContain("App iOS 1.2.0");
    expect(body).toContain("Azienda: Da Buffa & C. (ws-1)");
    // Niente `&` o spazi nudi: spezzerebbero il mailto.
    expect(query).not.toMatch(/ /);
    expect(query.split("&")).toHaveLength(2);
  });

  it("senza azienda non scrive la riga, senza nome usa l'id", () => {
    expect(
      decodeURIComponent(supportMailto("a@b.c", { surface: "Dashboard web" }))
    ).not.toContain("Azienda:");
    expect(
      decodeURIComponent(
        supportMailto("a@b.c", {
          surface: "Dashboard web",
          workspace: { id: "ws-2", name: "  " },
        })
      )
    ).toContain("Azienda: ws-2");
  });
});

describe("faqFor", () => {
  it("le domande riservate al titolare restano fuori per gli altri", () => {
    const ownerOnly = SUPPORT_FAQ.filter((item) => item.ownerOnly);
    expect(ownerOnly.length).toBeGreaterThan(0);
    for (const item of ownerOnly) {
      expect(faqFor("web")).not.toContain(item);
      expect(faqFor("web", { isOwner: true })).toContain(item);
    }
  });

  it("l'app nativa non parla di prezzi né di acquisti", () => {
    const native = [...faqFor("waiter"), ...faqFor("manager", { isOwner: true })];
    for (const item of native) {
      expect(`${item.q} ${item.a}`).not.toMatch(/€|prezz|piano|acquist|abbonament|checkout/i);
    }
  });
});

describe("supportScopeNote", () => {
  it("dice a tutti cosa vede l'assistenza, senza promettere che non vede niente", () => {
    for (const isOwner of [true, false]) {
      const note = supportScopeNote({ isOwner });
      expect(note).toContain(SUPPORT_DATA_NOTE);
      expect(note).not.toMatch(/non vede i dati/);
    }
  });

  it("rimanda alla sede solo chi non è il titolare", () => {
    expect(supportScopeNote({ isOwner: false })).toMatch(/scrivi alla tua sede/);
    expect(supportScopeNote({ isOwner: true })).not.toMatch(/scrivi alla tua sede/);
  });
});

describe("FAQ della timbratura", () => {
  it("racconta anche la timbratura senza turno", () => {
    const clock = SUPPORT_FAQ.find((item) => item.q === "Come timbro entrata e uscita?");
    expect(clock?.a).toMatch(/senza un turno/);
    expect(clock?.a).toMatch(/Fuori turno/);
  });
});
