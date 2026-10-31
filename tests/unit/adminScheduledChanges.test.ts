import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertKinds, canRetryScheduledChange, listScheduledChanges, resolveScheduledChange, retryScheduledChange,
  scheduledChangeListSchema, scheduledFailureReason,
} from "@/features/admin/scheduledChanges";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

const at = "2026-11-10T10:00:00+00:00";
const item = {
  id: "22222222-2222-4222-8222-222222222222", workspace_id: "11111111-1111-4111-8111-111111111111",
  workspace_name: "Hotel Tesoro", environment: "sandbox", status: "failed", close_reason: "rules_changed",
  target_plan: "base", target_interval: "month", target_extra_venues: 0, effective_at: "2999-01-01T10:00:00+00:00",
  renewal_cents: 2900, currency: "EUR", attempts: 2, last_error_code: "billing_scheduled_people", alert_kind: "failed",
  created_at: at, applied_at: null, confirmed_at: null, reviewed_at: null, review_note: null,
  requested_by_name: "Olivia Rossi",
};
const page = (items: unknown[]) => ({ generated_at: at, open_total: items.length, total: items.length, limit: 50, offset: 0, items });

describe("cambi programmati (client fondatore)", () => {
  it("accetta una voce valida", () => {
    expect(scheduledChangeListSchema.safeParse(page([item])).success).toBe(true);
  });
  it("accetta l'allarme «data non rimessa»", () => {
    expect(scheduledChangeListSchema.safeParse(page([{ ...item, status: "pending", close_reason: null,
      alert_kind: "date_not_fixed", last_error_code: "paddle_date_not_fixed" }])).success).toBe(true);
  });
  it("accetta l'allarme «rinnovo scaduto» e un nome mancante", () => {
    expect(scheduledChangeListSchema.safeParse(page([{ ...item, close_reason: "renewal_overdue",
      alert_kind: "renewal_overdue", requested_by_name: null }])).success).toBe(true);
  });
  it("gemello del CHECK: gli allarmi sono gli stessi del database", () => {
    expect([...alertKinds]).toEqual(["not_sent", "failed", "renewal_mismatch", "date_not_fixed", "renewal_overdue"]);
  });
  it("rifiuta un alert_kind sconosciuto", () => {
    expect(scheduledChangeListSchema.safeParse(page([{ ...item, alert_kind: "boh" }])).success).toBe(false);
  });
  it("il motivo lo decide la chiusura; il codice d'errore solo se manca", () => {
    expect(scheduledFailureReason({ close_reason: "rules_changed", last_error_code: "billing_scheduled_people" }))
      .toBe("le regole non valgono più: persone o sedi oltre il piano scelto, oppure azienda non operativa");
    expect(scheduledFailureReason({ close_reason: "paddle_mismatch", last_error_code: "paddle_items_changed" }))
      .toBe("su Paddle data o articoli sono cambiati");
    expect(scheduledFailureReason({ close_reason: "paddle_error", last_error_code: "paddle_rejected_422" }))
      .toBe("Paddle ha rifiutato il cambio");
    expect(scheduledFailureReason({ close_reason: null, last_error_code: "paddle_rejected_400" }))
      .toBe("Paddle ha rifiutato il cambio");
    expect(scheduledFailureReason({ close_reason: null, last_error_code: null })).toBe("errore sconosciuto");
    expect(scheduledFailureReason({ close_reason: "owner", last_error_code: null })).toBe("errore sconosciuto");
  });
  it("si ritenta solo con rinnovo futuro, pending o failed, non per rinnovo diverso", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(canRetryScheduledChange({ ...item, effective_at: "2026-11-02T00:00:00+00:00" } as never, now)).toBe(true);
    expect(canRetryScheduledChange({ ...item, effective_at: "2026-10-30T00:00:00+00:00" } as never, now)).toBe(false);
    expect(canRetryScheduledChange({ ...item, alert_kind: "renewal_mismatch", effective_at: "2026-11-02T00:00:00+00:00" } as never, now)).toBe(false);
    expect(canRetryScheduledChange({ ...item, status: "pending", alert_kind: "date_not_fixed", close_reason: null,
      effective_at: "2026-11-02T00:00:00+00:00" } as never, now)).toBe(true);
    expect(canRetryScheduledChange({ ...item, status: "applied", effective_at: "2026-11-02T00:00:00+00:00" } as never, now)).toBe(false);
    expect(canRetryScheduledChange({ ...item, status: "canceled", effective_at: "2026-11-02T00:00:00+00:00" } as never, now)).toBe(false);
  });
  it("chiama le RPC admin con i parametri giusti e valida la risposta", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: page([item]), error: null });
    const list = await listScheduledChanges({ workspaceId: null, attentionOnly: true, offset: 50 });
    expect(list.items[0]?.workspace_name).toBe("Hotel Tesoro");
    expect(rpc).toHaveBeenLastCalledWith("admin_list_scheduled_billing_changes",
      { p_workspace: undefined, p_attention_only: true, p_limit: 50, p_offset: 50 });
    rpc.mockResolvedValueOnce({ data: page([{ ...item, alert_kind: "boh" }]), error: null });
    await expect(listScheduledChanges({ workspaceId: item.workspace_id, attentionOnly: false, offset: 0 }))
      .rejects.toThrow("admin_response_invalid");
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await resolveScheduledChange({ id: item.id, note: "Rimborsato su Paddle" });
    expect(rpc).toHaveBeenLastCalledWith("admin_resolve_scheduled_billing_change", { p_id: item.id, p_note: "Rimborsato su Paddle" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "scheduled_change_not_retryable" } });
    await expect(retryScheduledChange(item.id)).rejects.toThrow("scheduled_change_not_retryable");
    expect(rpc).toHaveBeenLastCalledWith("admin_retry_scheduled_billing_change", { p_id: item.id });
  });
});

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read, useAdminWrite: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));

describe("ScheduledChanges (area fondatore)", () => {
  beforeEach(() => read.mockReset());
  async function render(items: unknown[], workspaceId?: string, state: Record<string, unknown> = {}) {
    const { ScheduledChanges } = await import("../../web/src/admin/ScheduledChanges");
    read.mockReturnValue({ isPending: false, isFetching: false, isError: false, data: page(items), ...state });
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ScheduledChanges, { userId: "founder", workspaceId })));
  }
  it("failed: motivo, Riprova adesso e nota", async () => {
    const html = await render([item]);
    expect(html).toContain("Hotel Tesoro");
    expect(html).toContain("Il cambio non si può applicare (le regole non valgono più: persone o sedi oltre il piano scelto, oppure azienda non operativa): il rinnovo avverrà col piano attuale. Avvisa il titolare.");
    expect(html).toContain("Riprova adesso");
    expect(html).toContain("Segna come verificato");
  });
  it("renewal_mismatch: niente Riprova adesso", async () => {
    const html = await render([{ ...item, alert_kind: "renewal_mismatch", status: "failed", close_reason: "renewal_mismatch" }]);
    expect(html).toContain("Il rinnovo è avvenuto con un piano diverso da quello programmato: controlla su Paddle e rimborsa la differenza.");
    expect(html).not.toContain("Riprova adesso");
    expect(html).toContain("Segna come verificato");
  });
  it("not_sent: testo dedicato", async () => {
    const html = await render([{ ...item, alert_kind: "not_sent", status: "pending", close_reason: null }]);
    expect(html).toContain("Il cambio non è ancora arrivato a Paddle e il rinnovo è fra meno di 6 ore. Prova a inviarlo di nuovo; se non va, al rinnovo Paddle addebita il piano attuale e la differenza va rimborsata.");
    expect(html).toContain("Riprova adesso");
  });
  it("date_not_fixed: testo dedicato con la data del rinnovo, e Riprova adesso", async () => {
    const html = await render([{ ...item, alert_kind: "date_not_fixed", status: "pending", close_reason: null,
      last_error_code: "paddle_date_not_fixed", effective_at: "2999-01-01T10:00:00+00:00" }]);
    expect(html).toContain("Il ciclo è cambiato su Paddle ma la data del rinnovo no: finché non torna al 1 gen 2999, 11:00, Paddle non addebita nel giorno giusto. Prova «Riprova adesso»; se non va, rimetti la data su Paddle.");
    expect(html).toContain(">Riprova adesso</button>");
    expect(html).toContain("Segna come verificato");
  });
  it("date_not_fixed già inviato (data rimessa): l'avviso resta da chiudere, senza Riprova adesso", async () => {
    const html = await render([{ ...item, alert_kind: "date_not_fixed", status: "applied", close_reason: null }]);
    expect(html).toContain("la data del rinnovo no");
    // Il testo nomina il pulsante; il pulsante non c'è.
    expect(html).not.toContain(">Riprova adesso</button>");
    expect(html).toContain("Segna come verificato");
  });
  it("failed col rinnovo passato: niente Riprova adesso, la nota resta", async () => {
    const html = await render([{ ...item, effective_at: "2020-01-01T10:00:00+00:00" }]);
    expect(html).not.toContain("Riprova adesso");
    expect(html).toContain("Segna come verificato");
  });
  it("voce già verificata nello storico dell'azienda: la nota, nessun modulo", async () => {
    const html = await render([{ ...item, reviewed_at: at, review_note: "Avvisato il titolare" }], item.workspace_id);
    expect(html).toContain("Cambi di piano programmati");
    expect(html).toContain("Avvisato il titolare");
    expect(html).not.toContain("Riprova adesso");
    expect(html).not.toContain("Segna come verificato");
  });
  it("chi ha chiesto il cambio, per nome", async () => {
    expect(await render([item])).toContain("Chiesto da Olivia Rossi");
    expect(await render([{ ...item, requested_by_name: null }])).not.toContain("Chiesto da");
  });
  it("renewal_overdue: testo dedicato, niente Riprova adesso", async () => {
    const html = await render([{ ...item, alert_kind: "renewal_overdue", status: "failed", close_reason: "renewal_overdue",
      effective_at: "2020-01-01T10:00:00+00:00" }]);
    expect(html).toContain("Paddle non ha rinnovato alla data del cambio: controlla data e articoli su Paddle, poi chiudi l&#x27;avviso con una nota.");
    expect(html).not.toContain("Riprova adesso");
    expect(html).toContain("Segna come verificato");
  });
  it("esito arrivato su un cambio già chiuso: Paddle ha il cambio, qui no", async () => {
    const html = await render([{ ...item, alert_kind: "renewal_mismatch", status: "canceled", close_reason: "paused" }]);
    expect(html).toContain("Paddle ha ricevuto il cambio, ma qui risultava già chiuso");
    expect(html).not.toContain("Il rinnovo è avvenuto con un piano diverso");
  });
  it("aggiornamento in corso: le voci restano montate (nota ed errore del ritentativo non si perdono)", async () => {
    const html = await render([item], undefined, { isFetching: true });
    expect(html).toContain("Hotel Tesoro");
    expect(html).toContain("Segna come verificato");
  });
  it("aggiornamento fallito con dati già letti: le voci restano, l'errore si vede", async () => {
    const html = await render([item], undefined, { isError: true, error: new Error("admin_response_invalid") });
    expect(html).toContain("Hotel Tesoro");
    expect(html).toContain('role="alert"');
  });
  it("prima lettura: lo scheletro", async () => {
    const html = await render([item], undefined, { isPending: true, data: undefined });
    expect(html).not.toContain("Hotel Tesoro");
  });
  it("niente da verificare", async () => {
    expect(await render([])).toContain("Niente da verificare");
  });
});
