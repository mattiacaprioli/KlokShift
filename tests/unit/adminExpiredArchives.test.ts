import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiredArchives } from "../../web/src/admin/ExpiredArchives";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read, useAdminWrite: () => ({ isPending: false, error: null, data: undefined, mutate: vi.fn() }),
}));
vi.mock("@/features/admin/archives", () => ({
  listExpiredArchives: vi.fn(), deleteWorkspaceDataAndFiles: vi.fn(), cleanupWorkspaceFiles: vi.fn(),
}));

const at = "2026-10-19T19:28:48+00:00";
const inventory = { venues: 2, shifts: 40, assignments: 80, clock_records: 75, members: 6, absences: 3,
  documents: 4, conversations: 2, messages: 30, notifications: 12, files_pending: 0 };
const base = { workspace_id: "11111111-1111-4111-8111-111111111111", workspace_name: "Bar Stagione",
  deleted_at: null, data_deleted_at: null, archive_until: at, subscription_open: false, inventory };
function render(items: unknown[]) {
  read.mockReturnValue({ isPending: false, isFetching: false, isError: false,
    data: { generated_at: at, total: items.length, limit: 25, offset: 0, items } });
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ExpiredArchives, { userId: "founder" })));
}

describe("Archivi scaduti (area fondatore)", () => {
  beforeEach(() => read.mockReset());
  it("da cancellare: inventario e avvio della cancellazione", () => {
    const html = render([base]);
    expect(html).toContain("Bar Stagione");
    expect(html).toContain("Da cancellare");
    expect(html).toContain("2 sedi · 40 turni");
    expect(html).toContain("Cancella i dati…");
  });
  it("abbonamento ancora aperto: niente cancellazione", () => {
    const html = render([{ ...base, subscription_open: true }]);
    expect(html).toContain("disdicilo prima");
    expect(html).not.toContain("Cancella i dati…");
  });
  it("già cancellata con file in coda: si riprova la pulizia", () => {
    const html = render([{ ...base, data_deleted_at: at, inventory: { ...inventory, files_pending: 3 } }]);
    expect(html).toContain("Dati cancellati");
    expect(html).toContain("3 file ancora da togliere");
    expect(html).toContain("Togli i file rimasti");
    expect(html).not.toContain("Cancella i dati…");
  });
  it("nessun archivio scaduto", () => {
    expect(render([])).toContain("nessun dato da cancellare");
  });
});
