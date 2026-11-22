import { describe, expect, it } from "vitest";
import { it as copy } from "../../../web-site/src/content/it";

/*
 * Le regole del copy della home (web-site/README.md e spec
 * 2026-11-15-sito-vetrina-wow-design.md) che i tipi non possono imporre.
 * Footer e pagina d'invito restano fuori: non fanno parte del ridisegno.
 */
function homeText({ withFaq = true } = {}): string {
  const { footer: _footer, invite: _invite, faq, plans, ...home } = copy;
  // Il nome del piano («Piccola») è lo stesso di dashboard e
  // pagina Piano: è un nome, non una stringa decorativa.
  const plansWithoutNames = {
    ...plans,
    options: plans.options.map(({ name: _name, ...rest }) => rest),
  };
  return JSON.stringify({ ...home, plans: plansWithoutNames, ...(withFaq ? { faq } : {}) });
}

describe("copy della home", () => {
  it("la home non usa stringhe a puntini", () => {
    expect(homeText()).not.toContain(" · ");
  });

  it("la home non promette cose che il prodotto non fa", () => {
    // Le domande restano fuori: «Fa le buste paga?» c'è apposta per dire di no.
    expect(homeText({ withFaq: false })).not.toMatch(
      /recension|bust[ae] paga|stipend|compens|candidatur|annunc|referral/i
    );
  });

  it("la storia ha quattro passi completi", () => {
    expect(copy.story.steps).toHaveLength(4);
    for (const step of copy.story.steps) {
      expect(step.before.trim()).not.toBe("");
      expect(step.title.trim()).not.toBe("");
      expect(step.body.trim()).not.toBe("");
      expect(step.before.startsWith("Prima:")).toBe(true);
    }
  });

  it("il listino dice ancora che siamo in beta e che i prezzi sono quelli del lancio", () => {
    // Era l'eyebrow «Listino previsto al lancio»: togliendo l'eyebrow il senso resta.
    expect(copy.plans.lead).toContain("beta");
    expect(`${copy.plans.title} ${copy.plans.lead}`).toContain("lancio");
  });

  it("il resto ha da sei a otto voci", () => {
    expect(copy.rest.items.length).toBeGreaterThanOrEqual(6);
    expect(copy.rest.items.length).toBeLessThanOrEqual(8);
  });

  it("i documenti non promettono un avviso che il prodotto non manda", () => {
    // La scadenza si vede sulla scheda («in scadenza»), ma nessuna notifica parte.
    const documents = copy.rest.items.find((item) => item.title.includes("Documenti"));
    expect(documents?.body).not.toMatch(/avvis|notific|ti avvert/i);
  });

  it("il passo del consulente non dice che il consulente riceve qualcosa da noi", () => {
    // KlokShift prepara i file; mandarli è del titolare.
    expect(copy.story.steps[3].title).not.toMatch(/riceve/i);
  });

  it("l'apertura ha l'avviso di conferma", () => {
    expect(copy.hero.toast.trim()).not.toBe("");
  });
});
