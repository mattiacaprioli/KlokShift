import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { it as siteContent } from "../../../web-site/src/content/it";

/**
 * Le pagine legali sono HTML statico scritto a mano: questo test tiene
 * insieme ciò che deve combaciare fra loro (spec DPA, §2 anti-obiettivi).
 */
const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "web-site/public", name), "utf8");
const text = (name: string) =>
  page(name).replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const NEW_PAGES = ["dpa.html", "sub-responsabili.html", "sicurezza.html", "dati-del-team.html"];
const PROVIDERS = ["Supabase", "Expo", "Apple", "Google", "Resend", "GitHub"];

describe("pagine legali", () => {
  it.each(NEW_PAGES)("%s esiste ed è versionata", (name) => {
    expect(text(name)).toContain("Versione 1");
  });

  it("la privacy non promette backup che non ci sono", () => {
    expect(text("privacy.html")).not.toMatch(/backup[^.]*30 giorni|30 giorni[^.]*backup/i);
  });

  it("la privacy nomina ogni sub-responsabile e non Google Fonts", () => {
    const privacy = text("privacy.html");
    for (const p of PROVIDERS) expect(privacy).toContain(p);
    expect(privacy).not.toContain("Google Fonts");
  });

  it("ogni sub-responsabile è nell'elenco pubblico", () => {
    const list = text("sub-responsabili.html");
    for (const p of PROVIDERS) expect(list).toContain(p);
  });

  it("i termini rimandano al DPA", () => {
    expect(page("termini.html")).toContain('href="dpa.html"');
  });

  it("il DPA porta i valori decisi e i suoi allegati", () => {
    const dpa = page("dpa.html");
    expect(text("dpa.html")).toContain("48 ore");
    expect(text("dpa.html")).toContain("15 giorni");
    for (const href of ["sub-responsabili.html", "sicurezza.html", "dati-del-team.html"]) {
      expect(dpa).toContain(`href="${href}"`);
    }
  });

  it("il footer resta corto: una voce sola porta a sicurezza, DPA e fornitori", () => {
    const hrefs = siteContent.footer.links.map((l) => l.href);
    expect(hrefs).toContain("./sicurezza.html");
    expect(hrefs).not.toContain("./dpa.html");
    expect(hrefs.length).toBeLessThanOrEqual(5);
    const security = page("sicurezza.html");
    for (const href of ["dpa.html", "sub-responsabili.html", "dati-del-team.html"]) {
      expect(security).toContain(`href="${href}"`);
    }
  });

  it("la sitemap elenca le pagine nuove", () => {
    const sitemap = page("sitemap.xml");
    for (const name of NEW_PAGES) expect(sitemap).toContain(`https://klokshift.com/${name}`);
  });

  it("l'eliminazione dell'account non promette backup che non ci sono", () => {
    expect(text("elimina-account.html")).not.toMatch(/backup[^.]*30 giorni|30 giorni[^.]*backup/i);
  });

  it("chi vede le malattie è detto per intero: Team e Ore", () => {
    for (const name of ["sicurezza.html", "dati-del-team.html", "dpa.html"]) {
      const body = text(name);
      expect(body).not.toMatch(/Le malattie le vede solo chi (nell'azienda )?gestisce il team/);
      expect(body).toMatch(/permesso «Team» o «Ore»/);
    }
  });

  it("le condizioni aggiuntive non attenuano le clausole 8 e 10", () => {
    const dpa = text("dpa.html");
    expect(dpa).not.toContain("5 giorni lavorativi");
    expect(dpa).not.toContain("Su richiesta, il responsabile del trattamento conferma");
  });
});
