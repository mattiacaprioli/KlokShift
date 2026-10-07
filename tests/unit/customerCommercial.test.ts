import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PianoPage } from "../../web/src/pages/Piano";
import { WorkspaceAccessBanner } from "../../web/src/WorkspaceAccessBanner";
import type { WorkspaceAccess } from "@/features/workspace/access";

const { context, mutate } = vi.hoisted(() => ({ context: vi.fn(), mutate: vi.fn() }));
vi.mock("@/features/venues/OwnerVenues", () => ({ useOwnerVenues: context }));
vi.mock("@/features/workspace/hooks", () => ({
  useStartWorkspaceTrial: () => ({ isPending: false, error: null, mutate }),
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
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(page)));
}
function situation(html: string) { return html.split("Listino previsto al lancio")[0]; }

describe("Piano e accesso del cliente", () => {
  beforeEach(() => { context.mockReturnValue(base); mutate.mockReset(); });
  it("separa la gratuità effettiva dal listino e non avvia nulla aprendo la pagina", () => {
    const html = render();
    const current = situation(html);
    expect(current).toContain("Gratuito a vita");
    expect(current).toContain("Senza limite");
    expect(current).toContain("Senza scadenza commerciale");
    expect(current).not.toContain("29,00");
    expect(current).not.toContain("Avvia la prova");
    expect(html).toContain("I pagamenti non sono ancora disponibili");
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
    expect(html).not.toContain("Listino");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("nel banner offre il dettaglio al titolare e lo evita nella pagina stessa", () => {
    expect(render(WorkspaceAccessBanner, "/")).toContain('href="/piano"');
    expect(render(WorkspaceAccessBanner)).toBe("");
    context.mockReturnValue({ ...base, isOwner: false });
    expect(render(WorkspaceAccessBanner, "/")).not.toContain('href="/piano"');
  });
});
