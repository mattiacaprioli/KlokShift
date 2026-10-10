import { describe, expect, it } from "vitest";

import {
  SUPPORT_FAQ,
  faqFor,
  supportMailto,
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
