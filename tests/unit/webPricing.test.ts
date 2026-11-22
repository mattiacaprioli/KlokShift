import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_PRICES, formatEuro, quotePlan } from "../../shared/pricing";
import { it as content } from "../../web-site/src/content/it";

describe("Listino web approvato", () => {
  it.each([
    ["base", 1, 29, 290], ["base", 2, 44, 440],
    ["team", 1, 49, 490], ["team", 3, 79, 790],
    ["large", 1, 89, 890], ["large", 3, 119, 1190], ["large", 5, 149, 1490],
  ] as const)("%s con %i sedi: mensile %i, annuale %i", (plan, venues, monthly, annual) => {
    expect(quotePlan(plan, "monthly", venues).total).toBe(monthly);
    const quote = quotePlan(plan, "annual", venues);
    expect(quote.total).toBe(annual);
    expect(quote.monthlyEquivalent).toBe(annual / 12);
    expect(annual).toBe(monthly * 10);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rifiuta sedi non valide o totali non rappresentabili: %s", (venues) => {
    expect(() => quotePlan("base", "monthly", venues)).toThrow("invalid_price_quote");
  });
  it("la vetrina usa lo stesso listino della dashboard", () => {
    expect(content.plans.options).toHaveLength(3);
    (["base", "team", "large"] as const).forEach((key, i) => {
      expect(content.plans.options[i].monthly.amount).toBe(formatEuro(PLAN_PRICES[key].monthly));
      expect(content.plans.options[i].annual.amount).toBe(formatEuro(PLAN_PRICES[key].annual));
    });
    expect(content.plans.options.map((o) => o.name)).toEqual(["Piccola", "Media", "Grande"]);
    expect(content.plans.options.map((o) => o.details[0])).toEqual([
      "Fino a 15 persone nell'intera azienda",
      "Da 16 a 40 persone",
      "Da 41 a 100 persone",
    ]);
    expect(content.plans.options[0].badge).toBe("Per iniziare");
    expect(content.plans.options[1].badge).toBe("Consigliato");
    expect(content.plans.options[2].badge).toBeUndefined();
  });
  it("oltre le fasce si scrive a info@klokshift.com e nessun piano si chiama Team", () => {
    expect(`${content.plans.custom.text} ${content.plans.custom.link}`).toContain("Oltre 100 persone o più di 5 sedi: scrivici");
    expect(content.plans.custom.email).toBe("info@klokshift.com");
    const text = JSON.stringify({ plans: content.plans, faq: content.faq });
    expect(text).not.toMatch(/\bTeam\b/);
    expect(content.faq.items.find((i) => i.q === "Serve una carta per provare?")?.a).toContain("fascia Grande e una sede");
    const html = readFileSync(new URL("../../web-site/index.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/prova Team/);
  });
  it("gli importi in prosa della vetrina derivano dal listino, senza cifre scritte a mano", () => {
    const [base, team, large] = content.plans.options;
    expect(base.annual.equivalent).toContain(formatEuro(290 / 12));
    expect(base.annual.saving).toBe("Risparmi 58\u00a0€ all'anno");
    expect(team.annual.equivalent).toContain(formatEuro(490 / 12));
    expect(team.annual.saving).toBe("Risparmi 98\u00a0€ all'anno");
    expect(large.annual.equivalent).toContain(formatEuro(890 / 12));
    expect(large.annual.saving).toBe("Risparmi 178\u00a0€ all'anno");
    expect(content.plans.extraVenue.monthly).toBe("Sede aggiuntiva: 15\u00a0€ al mese.");
    expect(content.plans.extraVenue.annual).toBe("Sede aggiuntiva: 150\u00a0€ all'anno — risparmi 30\u00a0€.");
    const faq = content.faq.items.map((item) => item.a).join(" ");
    expect(faq).toContain("15\u00a0€ al mese");
    expect(faq).not.toMatch(/\d €/);
  });
  it("la beta non pubblicizza un acquisto attivo o un piano gratuito illimitato nei metadata", () => {
    const html = readFileSync(new URL("../../web-site/index.html", import.meta.url), "utf8");
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(schema.offers).toBeUndefined();
    expect(schema.description).toContain("Acquisti non ancora disponibili");
    expect(html.match(/name="description"[\s\S]*?content="([^"]+)"/)![1]).toContain("Acquisti non ancora disponibili");
    expect(content.hero.note).toContain("In beta");
    expect(content.hero.note).toContain("nessun rinnovo automatico");
    expect(content.plans.note).toContain("Nessun addebito automatico");
    expect(content.faq.items.find(item => item.q === "Posso già acquistare un piano?")?.a).toContain("Non ancora");
  });
});
