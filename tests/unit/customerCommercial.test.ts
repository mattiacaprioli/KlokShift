import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PianoPage } from "../../web/src/pages/Piano";
import type { WorkspaceAccess } from "@/features/workspace/access";

const { context, mutate, billing, prepareCheckout } = vi.hoisted(() => ({
  context: vi.fn(), mutate: vi.fn(), billing: vi.fn(), prepareCheckout: vi.fn(),
}));
vi.mock("@/features/venues/OwnerVenues", () => ({ useOwnerVenues: context }));
vi.mock("@/features/workspace/hooks", () => ({
  useStartWorkspaceTrial: () => ({ isPending: false, error: null, mutate }),
  useWorkspaceBilling: billing,
}));
// Il checkout vero carica Supabase e Paddle.js: qui conta solo che aprire la pagina non lo avvii.
vi.mock("../../web/src/billing/checkout", () => ({ prepareCheckout, openCheckout: vi.fn() }));
vi.mock("../../web/src/billing/manage", () => ({
  openPortal: vi.fn(), resumeRenewals: vi.fn(), previewChange: vi.fn(), applyChange: vi.fn(),
  pauseRenewals: vi.fn(), restartSubscription: vi.fn(),
  formatCents: (cents: number) => `${cents / 100} €`,
}));

const access: WorkspaceAccess = {
  workspace_id: "azienda", state: "operational", source: "complimentary_lifetime", plan: "team",
  operational_from: "2026-10-06T19:11:00Z", operational_until: null,
  attendance_until: null, archive_until: null,
  can_operate: true, can_read: true, can_complete_attendance: true,
  limits: { people: null, venues: 1 }, usage: { people: 3, venues: 1 },
};
const base = {
  workspaceId: "azienda", workspaceName: "Azienda test", isOwner: true,
  access, accessPending: false, accessError: false,
  historyVenueIds: ["sede-chiusa"], canAny: () => true, refetch: vi.fn(),
};
function render(page: ComponentType = PianoPage, path = "/piano") {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(page))));
}
/** Solo il riquadro «Situazione attuale», prima di acquisto/abbonamento. */
function situation(html: string) { return html.split(/Attiva un abbonamento|<h2[^>]*>Abbonamento</)[0]; }
const noBilling = { isPending: false, isError: false, data: null };
const trialAccess: WorkspaceAccess = { ...access, source: "trial", operational_until: "2026-11-05T19:11:00Z",
  attendance_until: "2026-11-12T19:11:00Z", archive_until: "2027-11-05T19:11:00Z",
  limits: { people: null, venues: 1 }, usage: { people: 3, venues: 1 } };

describe("Piano e accesso del cliente", () => {
  beforeEach(() => {
    context.mockReturnValue(base); mutate.mockReset(); prepareCheckout.mockReset();
    billing.mockReturnValue(noBilling);
  });
  it("separa la gratuità effettiva dal listino e non avvia nulla aprendo la pagina", () => {
    const html = render();
    const current = situation(html);
    expect(current).toContain("Gratuito a vita");
    expect(current).toContain("Senza limite");
    expect(current).toContain("Senza scadenza commerciale");
    expect(current).not.toContain("29,00");
    expect(current).not.toContain("Avvia la prova");
    expect(html).not.toContain("Procedi al pagamento");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("non ricava un piano o capacità infinite dal vecchio Pro di un’azienda preesistente", () => {
    context.mockReturnValue({ ...base, plan: "pro", access: { ...access,
      state: "migration_pending", source: null, plan: null, operational_from: null,
      limits: { people: null, venues: null }, can_operate: false, can_complete_attendance: false,
    } });
    const current = situation(render());
    expect(current).toContain("Puoi continuare a lavorare");
    expect(current).toContain("Non assegnato");
    expect(current).not.toContain("Senza limite");
    expect(current).not.toContain("Avvia la prova");
    expect(current).toContain('href="/ore"');
  });
  it.each([0, 1])("la nuova azienda con %i sedi prepara la prova senza avviarla da sola", (venues) => {
    context.mockReturnValue({ ...base, access: { ...access, state: "setup", source: null,
      plan: null, operational_from: null, limits: { people: null, venues: null },
      usage: { people: 0, venues }, can_operate: false, can_complete_attendance: false,
    } });
    const html = situation(render());
    expect(html).toContain(venues ? "Avvia la prova di 30 giorni" : "Prepara la prima sede");
    expect(html).not.toContain("Conferma e avvia");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("mantiene storico ed export in archivio, con finestre distinte e senza nuova prova", () => {
    context.mockReturnValue({ ...base, access: { ...access, state: "archive", source: "trial",
      can_operate: false, operational_until: "2026-11-05T19:11:00Z",
      attendance_until: "2026-11-12T19:11:00Z", archive_until: "2027-11-05T19:11:00Z",
    } });
    const html = situation(render());
    expect(html).toContain('href="/storico"');
    expect(html).toContain('href="/ore"');
    expect(html).toContain("Termine rettifiche pregresse");
    expect(html).toContain("Termine consultazione ed export");
    expect(html).toContain("non prolunga l’archivio");
    expect(html).not.toContain("Avvia la prova");
  });
  it("un refresh fallito nasconde il diritto in cache e l’avvio, senza togliere i percorsi allo storico", () => {
    context.mockReturnValue({ ...base, accessError: true });
    const html = situation(render());
    expect(html).toContain("Stato dell&#x27;azienda non disponibile");
    expect(html).not.toContain("Gratuito a vita");
    expect(html).not.toContain("Avvia la prova");
    expect(html).toContain('href="/ore"');
  });
  it("nega la pagina al collaboratore anche raggiungendola dall’URL", () => {
    context.mockReturnValue({ ...base, isOwner: false });
    const html = render();
    expect(html).toContain("riservata al titolare");
    expect(html).not.toContain("Situazione attuale");
    expect(html).not.toContain("Procedi al pagamento");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("in prova propone l’acquisto con prezzo, IVA e avviso sui giorni persi, senza avviarlo", () => {
    context.mockReturnValue({ ...base, access: trialAccess });
    const html = render();
    expect(html).toContain("Attiva un abbonamento");
    expect(html).toContain("29,00");
    expect(html).toContain("+ IVA");
    expect(html).toContain("i giorni di prova rimasti non si sommano");
    expect(html).toContain("termini.html");
    expect(html).toContain("rimborsi.html");
    expect(prepareCheckout).not.toHaveBeenCalled();
  });
  it("oltre 30 persone non offre il piano Base", () => {
    context.mockReturnValue({ ...base, access: { ...trialAccess, usage: { people: 31, venues: 1 } } });
    const html = render();
    expect(html).not.toContain("Base · fino a 30 persone");
    expect(html).toContain("Base arriva a 30 persone: oggi ne conti 31.");
  });
  it("con un abbonamento aperto mostra rinnovo e stato, non un secondo acquisto", () => {
    context.mockReturnValue({ ...base, access: { ...trialAccess, source: "subscription" } });
    billing.mockReturnValue({ ...noBilling, data: {
      status: "past_due", plan: "team", billing_interval: "year", extra_venues: 1,
      current_period_ends_at: "2027-10-18T10:00:00Z", scheduled_change: null,
      past_due_since: "2026-10-18T10:00:00Z", canceled_at: null,
    } });
    const html = render();
    expect(html).toContain("Rinnovo non riuscito");
    expect(html).toContain("Team · annuale");
    expect(html).toContain("l’operatività continua per 7 giorni");
    expect(html).not.toContain("Procedi al pagamento");
  });
  const subscriptionAccess = () => context.mockReturnValue({ ...base, access: { ...trialAccess, source: "subscription" } });
  const subscription = {
    status: "active", plan: "base", billing_interval: "month", extra_venues: 0,
    current_period_ends_at: "2026-11-18T10:00:00Z", scheduled_change: null, past_due_since: null, canceled_at: null,
    paused_at: null,
  };
  it("abbonamento attivo: gestione dal portale e solo aumenti dalla pagina", () => {
    subscriptionAccess();
    billing.mockReturnValue({ ...noBilling, data: subscription });
    const html = render();
    expect(html).toContain("Ricevute e metodo di pagamento");
    expect(html).toContain("Ferma i rinnovi");
    expect(html).toContain("Metti in pausa");
    expect(html).toContain("Aumenta piano o sedi");
    expect(html).toContain("Calcola l’importo");
    expect(html).toContain("Per passare a un piano più piccolo, ridurre le sedi o cambiare tra mensile e annuale");
    expect(html).not.toContain("Riprendi i rinnovi");
  });
  it("disdetta programmata: ultimo giorno, riprendi i rinnovi, nessun aumento", () => {
    subscriptionAccess();
    billing.mockReturnValue({ ...noBilling, data: { ...subscription,
      scheduled_change: { action: "cancel", effective_at: "2026-11-18T10:00:00Z" } } });
    const html = render();
    expect(html).toContain("Ultimo giorno");
    expect(html).toContain("Riprendi i rinnovi");
    expect(html).not.toContain("Ferma i rinnovi");
    expect(html).not.toContain("Aumenta piano o sedi");
  });
  it("pausa programmata: annulla la pausa, nessun aumento né disdetta", () => {
    subscriptionAccess();
    billing.mockReturnValue({ ...noBilling, data: { ...subscription,
      scheduled_change: { action: "pause", effective_at: "2026-11-18T10:00:00Z" } } });
    const html = render();
    expect(html).toContain("Pausa programmata");
    expect(html).toContain("Annulla la pausa");
    expect(html).not.toContain("Metti in pausa");
    expect(html).not.toContain("Ferma i rinnovi");
    expect(html).not.toContain("Aumenta piano o sedi");
  });
  it("in pausa: riparti ora, nessuna disdetta né aumento", () => {
    context.mockReturnValue({ ...base, access: { ...trialAccess, state: "archive", source: "subscription", can_operate: false } });
    billing.mockReturnValue({ ...noBilling, data: { ...subscription, status: "paused", paused_at: "2026-11-18T10:00:00Z" } });
    const html = render();
    expect(html).toContain("In pausa dal");
    expect(html).toContain("Riparti ora");
    expect(html).not.toContain("Ferma i rinnovi");
    expect(html).not.toContain("Metti in pausa");
    expect(html).not.toContain("Aumenta piano o sedi");
    expect(html).not.toContain("Procedi al pagamento");
  });
  it("rinnovo non riuscito: in evidenza l’aggiornamento della carta, nessun aumento", () => {
    subscriptionAccess();
    billing.mockReturnValue({ ...noBilling, data: { ...subscription, status: "past_due", past_due_since: "2026-11-18T10:00:00Z" } });
    const html = render();
    expect(html).toContain("Aggiorna il metodo di pagamento");
    expect(html).not.toContain("Aumenta piano o sedi");
  });
  it("Team: il modulo non propone di tornare a Base", () => {
    subscriptionAccess();
    billing.mockReturnValue({ ...noBilling, data: { ...subscription, plan: "team" } });
    expect(render()).not.toContain("Base · fino a 30 persone");
  });
});
