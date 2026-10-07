import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatEuro, quotePlan } from "../../shared/pricing";
import { it as content } from "../../web-site/src/content/it";

describe("Listino web approvato", () => {
  it.each([
    ["base", 1, 29, 290], ["base", 2, 44, 440],
    ["team", 1, 49, 490], ["team", 3, 79, 790],
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
    expect(content.plans.options[0].monthly.amount).toBe(formatEuro(29));
    expect(content.plans.options[0].annual.amount).toBe(formatEuro(290));
    expect(content.plans.options[1].monthly.amount).toBe(formatEuro(49));
    expect(content.plans.options[1].annual.amount).toBe(formatEuro(490));
  });
  it("la beta non pubblicizza un acquisto attivo o un piano gratuito illimitato nei metadata", () => {
    const html = readFileSync(new URL("../../web-site/index.html", import.meta.url), "utf8");
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(schema.offers).toBeUndefined();
    expect(schema.description).toContain("Acquisti non ancora disponibili");
    expect(html.match(/name="description"[\s\S]*?content="([^"]+)"/)![1]).toContain("Acquisti non ancora disponibili");
    expect(content.hero.note).toContain("I pagamenti non sono ancora disponibili");
    expect(content.plans.note).toContain("Nessun addebito automatico");
    expect(content.faq.items.find(item => item.q === "Posso già acquistare un piano?")?.a).toContain("non sono ancora disponibili");
  });
});
