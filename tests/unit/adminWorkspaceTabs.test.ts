import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage, WorkspacesPage, AccountsPage } from "../../web/src/admin/pages";

const { read, mutate } = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read, useAdminWrite: () => ({ isPending: false, mutateAsync: mutate }),
}));
vi.mock("@/features/admin/api", () => ({
  getAdminOverview: vi.fn(), listAdminWorkspaces: vi.fn(), getAdminWorkspace: vi.fn(),
  listAdminAccounts: vi.fn(), getAdminAccount: vi.fn(),
}));
vi.mock("@/features/admin/controls", () => ({
  applyWorkspaceAction: vi.fn(), getWorkspaceControl: vi.fn(), getAccountControl: vi.fn(),
  setAccountClassification: vi.fn(), listOperations: vi.fn(),
}));

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-06T12:00:00+00:00";
const empty = { total: 0, limit: 25, offset: 0, items: [] };
const access = {
  workspace_id: id, state: "operational", source: "complimentary_lifetime", plan: "base",
  operational_from: at, operational_until: null, attendance_until: null, archive_until: null,
  limits: { people: 30, venues: 2 }, usage: { people: 3, venues: 1 },
};
const detail = {
  generated_at: at,
  workspace: {
    id, name: "Azienda fixture", state: "operational", classification: "test", deleted_at: null,
    access, open_venues: 1, document_known_bytes: 31045, document_files: 1,
    document_unknown_sizes: 0, flags: [],
  },
  members: empty, venues: empty, periods: empty, classification_reason: "Fixture UI",
  activity: { last_shift_created_at: at, last_clock_in_at: null, last_manager_sign_in_at: at },
};
const control = {
  revision: "a".repeat(32), snapshot: {
    classification: "test", access, document_known_bytes: 31045, document_unknown_sizes: 0,
    lifetime: { plan: "base", venue_limit: 2, document_limit_bytes: 4096 * 1048576 },
  },
};
function render(scheda?: string) {
  const path = `/amministrazione/aziende/${id}${scheda ? `?scheda=${scheda}` : ""}`;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null, createElement(Route, {
      path: "/amministrazione/aziende/:id", element: createElement(WorkspacePage, { userId: "founder" }),
    }))));
}
function visiblePanel(html: string) {
  const panels = [...html.matchAll(/<section\b([^>]*)>(.*?)<\/section>/gs)]
    .filter((m) => !/\bhidden=/.test(m[1]));
  expect(panels).toHaveLength(1);
  return { attributes: panels[0][1], content: panels[0][2] };
}
describe("Scheda azienda del fondatore", () => {
  beforeEach(() => {
    mutate.mockReset();
    read.mockReset();
    read.mockImplementation((_user, resource) => ({
      isSuccess: true,
      data: resource === "workspace" ? detail : resource === "workspace-control" ? control :
        { ...empty, generated_at: at },
    }));
  });
  it.each([
    ["riepilogo", "Riepilogo", "Piano e capacità attuali"],
    ["persone", "Persone e sedi", "Membri aziendali"],
    ["gestione", "Gestione", "Prepara una modifica"],
    ["cronologia", "Cronologia", "Registro amministrativo"],
  ])("apre la scheda %s dall’URL senza applicare interventi", (tab, label, content) => {
    const html = render(tab);
    const panel = visiblePanel(html);
    expect(html).toContain("Azienda fixture");
    expect(html).toContain('aria-label="Schede azienda"');
    const activeLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>.*?<\/a>/gs);
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks![0]).toContain(`?scheda=${tab}`);
    expect(activeLinks![0]).toContain(`>${label}</a>`);
    expect(panel.attributes).toContain(`aria-label="${label}"`);
    expect(panel.content).toContain(content);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("parte dal riepilogo anche con una scheda sconosciuta", () => {
    expect(visiblePanel(render()).attributes).toContain('aria-label="Riepilogo"');
    expect(visiblePanel(render("inesistente")).attributes).toContain('aria-label="Riepilogo"');
  });
  it("distingue conteggi e limiti non assegnati per le aziende preesistenti", () => {
    read.mockImplementation((_user, resource) => ({ isSuccess: true, data: resource === "workspace" ? {
      ...detail, workspace: { ...detail.workspace, state: "migration_pending", access: {
        ...access, state: "migration_pending", source: null, plan: null,
        operational_from: null, limits: { people: null, venues: null },
      } },
    } : resource === "workspace-control" ? { ...control, snapshot: { ...control.snapshot, lifetime: null } } : empty }));
    const panel = visiblePanel(render());
    expect(panel.content).toContain("Persone in azienda</dt><dd>3");
    expect(panel.content).toContain("Limite persone</dt><dd>Non assegnato");
    expect(panel.content).toContain("Sedi aperte</dt><dd>1");
    expect(panel.content).toContain("Sedi consentite</dt><dd>Non assegnato");
    expect(panel.content).not.toContain("Prepara una modifica");
  });
  it("prepara la variazione dai valori concessi senza proporre un altro piano", () => {
    const panel = visiblePanel(render("gestione"));
    expect(panel.content).toContain("Situazione attuale");
    const triggers = [...panel.content.matchAll(/<button\b[^>]*role="combobox"[^>]*>(.*?)<\/button>/gs)];
    expect(triggers[1][1]).toContain("Base · fino a 30 persone");
    expect(panel.content).toMatch(/<input[^>]*value="2"/);
    expect(panel.content).toMatch(/<input[^>]*value="4096"/);
    expect(panel.content).toContain("0,03 MiB");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("nasconde schede e moduli dopo un diniego anche se erano presenti dati", () => {
    read.mockReturnValue({ isError: true, error: new Error("admin_not_allowed"), data: detail });
    const html = render("gestione");
    expect(html).toContain("Dati non disponibili");
    expect(html).not.toContain("Azienda fixture");
    expect(html).not.toContain("Prepara una modifica");
    expect(read).toHaveBeenCalledOnce();
  });
  it("i filtri aziende e account espongono le scelte al menu personalizzato", () => {
    for (const page of [WorkspacesPage, AccountsPage]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null,
        createElement(page, { userId: "founder" })));
      const triggers = [...html.matchAll(/<button\b[^>]*role="combobox"[^>]*>(.*?)<\/button>/gs)];
      expect(triggers.length).toBe(page === WorkspacesPage ? 3 : 2);
      for (const trigger of triggers) {
        expect(trigger[1]).toContain("Tutti");
        expect(trigger[1]).not.toContain("Seleziona…");
      }
    }
  });
});
