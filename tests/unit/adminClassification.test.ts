import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AccountClassification, useAccountClassificationDraft } from "../../web/src/admin/WorkspaceActions";
import type { AccountControl } from "@/features/admin/controls";

vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: () => ({ isSuccess: true, data: { classification: "unclassified" } }),
  useAdminWrite: () => ({ isPending: false }),
}));
vi.mock("@/features/admin/controls", () => ({
  applyWorkspaceAction: vi.fn(), getWorkspaceControl: vi.fn(), getAccountControl: vi.fn(),
  setAccountClassification: vi.fn(), listOperations: vi.fn(),
}));

it("mostra la classificazione corrente nel controllo visibile e tutte le scelte", () => {
  const html = renderToStaticMarkup(createElement(AccountClassification, {
    userId: "founder", accountId: "account",
  }));
  // Il select nativo nascosto aveva già le opzioni anche durante il bug:
  // il pulsante del menu personalizzato mostrava invece «Seleziona…».
  const trigger = html.match(/<button\b[^>]*role="combobox"[^>]*>(.*?)<\/button>/s)?.[1];
  expect(trigger).toContain("Non classificato");
  expect(trigger).not.toContain("Seleziona…");
  for (const [value, label] of [
    ["customer", "Cliente"], ["internal", "Interno"], ["test", "Test"],
    ["unclassified", "Non classificato"],
  ]) {
    expect(html).toMatch(new RegExp(`<option value="${value}"[^>]*>${label}</option>`));
  }
});

it.each(["customer", "internal", "test", "unclassified"] as const)(
  "senza modifiche prepara un comando con la classificazione corrente %s",
  (classification) => {
    const control: AccountControl = {
      target_id: "account", generated_at: "2026-10-15T12:00:00Z",
      revision: "a".repeat(32), classification,
    };
    let draft: ReturnType<typeof useAccountClassificationDraft> | undefined;
    function Probe() {
      draft = useAccountClassificationDraft("account", control);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(draft!.prepare("  Classificazione verificata  ")).toMatchObject({
      accountId: "account", revision: control.revision, classification,
      reason: "Classificazione verificata",
    });
  }
);
