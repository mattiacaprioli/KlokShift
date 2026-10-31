import { describe, expect, it, vi } from "vitest";

import {
  checkScheduledTarget, formatAlert, formatReminder, isPermanent, paddleErrorCode, parseAlert, parseScheduledChange,
  runScheduled, scheduledDateBody, scheduledPatchBody, type AlertInfo, type QueuedEmail, type ScheduledChange, type ScheduledDeps,
} from "../../../supabase/functions/billing-scheduled/logic";
import { edgeRuntime, post } from "./runtime";

const ID = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const EFFECTIVE = "2026-11-17T23:30:00Z";
const FROM = [{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extra", quantity: 2 }];
const TARGET = [{ price_id: "pri_01base", quantity: 1 }];

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ID, subscription_id: SUB, workspace_id: WORKSPACE, requested_by: "44444444-4444-4444-8444-444444444444",
  target_plan: "base", target_interval: "year", target_extra_venues: 1, from_interval: "year", from_items: FROM,
  target_items: TARGET,
  renewal_cents: 29000, currency: "EUR", effective_at: EFFECTIVE, alert_kind: null, last_error_code: null,
  status: "pending", reviewed_at: null, reminder_email_attempts: 0, alert_email_attempts: 0, ...over,
});
const change = (over: Record<string, unknown> = {}) => parseScheduledChange(raw(over)) as ScheduledChange;
const alert = (over: Record<string, unknown> = {}) => parseAlert(raw({ alert_kind: "failed", ...over })) as AlertInfo;
const paddleItem = (id: string, quantity = 1, extra: Record<string, unknown> = {}) =>
  ({ price: { id }, quantity, status: "active", recurring: true, ...extra });
const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_01x", status: "active", next_billed_at: EFFECTIVE, scheduled_change: null,
  billing_cycle: { interval: "year", frequency: 1 },
  current_billing_period: { starts_at: "2025-11-17T23:30:00Z", ends_at: EFFECTIVE },
  items: [paddleItem("pri_01extra", 2), paddleItem("pri_01team")], ...over,
});

describe("billing-scheduled: confronto con Paddle", () => {
  const row = { effectiveAt: EFFECTIVE, fromInterval: "year" as const, fromItems: FROM };

  it("stesso insieme in ordine diverso: si può inviare", () => {
    expect(checkScheduledTarget(subscription(), row)).toBeNull();
  });

  it("ignora gli articoli non attivi o non ricorrenti", () => {
    expect(checkScheduledTarget(subscription({ items: [paddleItem("pri_01team"), paddleItem("pri_01extra", 2),
      paddleItem("pri_01old", 1, { status: "inactive" }), paddleItem("pri_01once", 1, { recurring: false })] }), row)).toBeNull();
  });

  it("data del rinnovo spostata di 3 minuti", () => {
    expect(checkScheduledTarget(subscription({ next_billed_at: "2026-11-17T23:33:00Z" }), row)).toBe("paddle_period_moved");
    expect(checkScheduledTarget(subscription({ next_billed_at: "2026-11-17T23:31:59Z" }), row)).toBeNull();
    expect(checkScheduledTarget(subscription({ next_billed_at: null }), row)).toBe("paddle_period_moved");
  });

  it("articolo in più o quantità diversa", () => {
    expect(checkScheduledTarget(subscription({ items: [...subscription().items, paddleItem("pri_01other")] }), row))
      .toBe("paddle_items_changed");
    expect(checkScheduledTarget(subscription({ items: [paddleItem("pri_01team"), paddleItem("pri_01extra", 3)] }), row))
      .toBe("paddle_items_changed");
    expect(checkScheduledTarget(subscription({ items: "x" }), row)).toBe("paddle_items_changed");
  });

  it("ciclo su Paddle illeggibile o diverso da quello della richiesta: periodo che non torna", () => {
    expect(checkScheduledTarget(subscription({ billing_cycle: { interval: "month", frequency: 1 } }), row))
      .toBe("paddle_period_moved");
    expect(checkScheduledTarget(subscription({ billing_cycle: null }), row)).toBe("paddle_period_moved");
  });

  it("abbonamento non attivo o con un altro cambio già programmato su Paddle", () => {
    expect(checkScheduledTarget(subscription({ status: "paused" }), row)).toBe("paddle_not_active");
    expect(checkScheduledTarget(subscription({ scheduled_change: { action: "cancel" } }), row)).toBe("paddle_not_active");
    expect(checkScheduledTarget(null, row)).toBe("paddle_not_active");
  });

  it("la PATCH non addebita né accredita niente adesso", () => {
    expect(scheduledPatchBody(TARGET)).toEqual({ items: TARGET, proration_billing_mode: "do_not_bill" });
  });

  it("la PATCH della data rimette il rinnovo alla data d'effetto, senza addebito", () => {
    expect(scheduledDateBody(EFFECTIVE)).toEqual({ next_billed_at: EFFECTIVE, proration_billing_mode: "do_not_bill" });
    // Il formato del database (offset, microsecondi) diventa quello provato in sandbox.
    expect(scheduledDateBody("2026-11-17T23:30:00+00:00").next_billed_at).toBe("2026-11-17T23:30:00Z");
    // Secondi interi, come gli unici provati con Paddle: il confronto resta ±120 s.
    expect(scheduledDateBody("2026-11-18T00:30:00.250+01:00").next_billed_at).toBe("2026-11-17T23:30:00Z");
    expect(scheduledDateBody("2026-10-31T12:30:48.601Z").next_billed_at).toBe("2026-10-31T12:30:48Z");
    expect(scheduledDateBody("2026-10-31T12:30:48.601234+00:00").next_billed_at).toBe("2026-10-31T12:30:48Z");
  });

  it("errori permanenti e transitori", () => {
    const cases: [string, boolean][] = [
      ["paddle_not_active", true], ["paddle_period_moved", true], ["paddle_items_changed", true],
      [paddleErrorCode(400), true], [paddleErrorCode(404), true], [paddleErrorCode(422), true],
      [paddleErrorCode(0), false], [paddleErrorCode(429), false], [paddleErrorCode(500), false],
      [paddleErrorCode(503), false], [paddleErrorCode(401), false], [paddleErrorCode(409), false],
      ["paddle_date_not_fixed", false], ["paddle_date_not_fixed_final", true],
    ];
    for (const [code, permanent] of cases) expect([code, isPermanent(code)]).toEqual([code, permanent]);
    expect(paddleErrorCode(503)).toBe("paddle_unavailable");
    expect(paddleErrorCode(404)).toBe("paddle_rejected_404");
  });

  it("una riga incompleta non si legge", () => {
    expect(change()).toMatchObject({ id: ID, subscriptionId: SUB, targetItems: TARGET, renewalCents: 29000 });
    expect(parseScheduledChange(raw({ target_items: [] }))).toBeNull();
    expect(parseScheduledChange(raw({ from_items: [{ price_id: "pri_01x" }] }))).toBeNull();
    expect(parseScheduledChange(raw({ effective_at: "domani" }))).toBeNull();
    expect(parseScheduledChange(raw({ from_interval: null }))).toBeNull();
    expect(change({ from_interval: "month" }).fromInterval).toBe("month");
  });
});

describe("billing-scheduled: email", () => {
  it("promemoria al titolare: data di Roma, importo, link alla pagina Piano", () => {
    const mail = formatReminder(change(), "Bar <Stagione>", "https://k.test/app/");
    expect(mail.subject).toBe("Dal 18/11/2026 cambia l'abbonamento di Bar <Stagione>");
    expect(mail.text).toContain("290,00 €");
    expect(mail.text).toContain("IVA compresa");
    expect(mail.text).toContain("Base");
    expect(mail.text).toContain("annuale");
    expect(mail.text).toContain("2 sedi");
    expect(mail.text).toContain("https://k.test/app/#/piano");
    expect(mail.html).toContain('<a href="https://k.test/app/#/piano">');
    expect(mail.html).toContain("Bar &lt;Stagione&gt;");
    expect(mail.html).not.toContain("<Stagione>");
  });

  it("allarme al fondatore: motivo, data del rinnovo, link alla scheda azienda", () => {
    const mail = formatAlert(alert({ last_error_code: "paddle_items_changed" }), "Bar Sole", "https://k.test/app");
    expect(mail.subject).toBe("[KlokShift] Cambio di piano da controllare: Bar Sole");
    expect(mail.text).toContain("18/11/2026");
    expect(mail.text).toContain("articoli");
    expect(mail.text).toContain("paddle_items_changed");
    expect(mail.text).toContain(`https://k.test/app/#/amministrazione/aziende/${WORKSPACE}`);
    expect(mail.text).toContain("Base, annuale, 2 sedi");
    expect(formatAlert(alert({ alert_kind: "not_sent" }), "Bar Sole", "https://k.test/app").text).toContain("6 ore");
    expect(formatAlert(alert({ alert_kind: "renewal_mismatch", close_reason: "renewal_mismatch" }), "Bar Sole",
      "https://k.test/app").text).toContain("articoli diversi");
  });

  it("allarme «data non rimessa»: il ciclo è cambiato, la data del rinnovo no", () => {
    const row = alert({ alert_kind: "date_not_fixed", last_error_code: "paddle_date_not_fixed" });
    expect(row.alertKind).toBe("date_not_fixed");
    expect(change({ alert_kind: "date_not_fixed" }).alertKind).toBe("date_not_fixed");
    const text = formatAlert(row, "Bar Sole", "https://k.test/app").text;
    expect(text).toContain("Motivo: il ciclo è cambiato su Paddle ma la data del rinnovo non è stata rimessa (codice paddle_date_not_fixed).");
    expect(text).toContain("18/11/2026");
    expect(text).not.toContain("non partirà da solo");
    expect(parseAlert(raw({ alert_kind: "boh" }))).toBeNull();
  });

  it("allarme «rinnovo scaduto»: Paddle non ha rinnovato alla data del cambio", () => {
    const row = alert({ alert_kind: "renewal_overdue", close_reason: "renewal_overdue", last_error_code: null });
    expect(row.alertKind).toBe("renewal_overdue");
    expect(change({ alert_kind: "renewal_overdue" }).alertKind).toBe("renewal_overdue");
    const text = formatAlert(row, "Bar Sole", "https://k.test/app").text;
    expect(text).toContain("Motivo: Paddle non ha rinnovato alla data del cambio.");
    expect(text).not.toContain("codice");
    expect(text).toContain("18/11/2026");
  });

  it("allarme «data non rimessa» definitivo: gli articoli sono su Paddle, la data non si rimette più da qui", () => {
    const text = formatAlert(alert({ alert_kind: "date_not_fixed", close_reason: "date_not_fixed",
      last_error_code: "paddle_date_not_fixed_final" }), "Bar Sole", "https://k.test/app").text;
    expect(text).toContain("codice paddle_date_not_fixed_final");
    expect(text).toContain("non si può più rimettere");
    expect(text).not.toContain("il rinnovo avverrà col piano attuale");
  });

  it("esito positivo su un cambio già chiuso: Paddle ha il cambio, qui era chiuso", () => {
    const late = formatAlert(alert({ alert_kind: "renewal_mismatch", status: "canceled", close_reason: "paused" }),
      "Bar Sole", "https://k.test/app").text;
    expect(late).toContain("è arrivato a Paddle, ma qui risultava già chiuso");
    expect(late).not.toContain("articoli diversi");
    const renewed = formatAlert(alert({ alert_kind: "renewal_mismatch", status: "failed", close_reason: "renewal_mismatch" }),
      "Bar Sole", "https://k.test/app").text;
    expect(renewed).toContain("articoli diversi");
  });

  it("allarme: lettura indulgente, il punto d'arrivo è facoltativo", () => {
    const partial = parseAlert(raw({ alert_kind: "failed", target_items: "x", target_plan: null }));
    expect(partial).toMatchObject({ id: ID, workspaceId: WORKSPACE, alertKind: "failed", target: null });
    expect(formatAlert(partial!, "Bar Sole", "https://k.test/app").text).toContain("non leggibile");
    expect(parseAlert(raw({ alert_kind: null }))).toBeNull();
    expect(parseAlert(raw({ alert_kind: "failed", workspace_id: null }))).toBeNull();
  });
});

type Fns = { [K in Exclude<keyof ScheduledDeps, "founderEmail">]: ReturnType<typeof vi.fn> };
function deps(over: Partial<ScheduledDeps> = {}): ScheduledDeps & Fns {
  return {
    claim: vi.fn(async () => [raw()]),
    getSubscription: vi.fn(async () => ({ ok: true as const, providerId: "sub_01x", subscription: subscription() })),
    patchSubscription: vi.fn(async () => ({ ok: true as const })),
    result: vi.fn(async () => true),
    listReminderEmails: vi.fn(async () => []),
    listAlertEmails: vi.fn(async () => []),
    reminderRecipient: vi.fn(async () => "titolare@example.test"),
    founderEmail: "info@example.test",
    send: vi.fn(async () => true),
    markReminder: vi.fn(async () => true),
    markAlert: vi.fn(async () => true),
    ...over,
  } as never;
}

describe("billing-scheduled: invio", () => {
  it("successo: PATCH con gli articoli d'arrivo e riga applicata", async () => {
    const d = deps();
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 1, failed: 0, retry: 0 });
    expect(d.getSubscription).toHaveBeenCalledWith(SUB);
    expect(d.patchSubscription).toHaveBeenCalledWith("sub_01x", { items: TARGET, proration_billing_mode: "do_not_bill" });
    expect(d.result).toHaveBeenCalledWith(ID, true, null, false);
  });

  it("GET fallito: si riprova più tardi", async () => {
    const d = deps({ getSubscription: vi.fn(async () => ({ ok: false as const, status: 503 })) });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, retry: 1 });
    expect(d.patchSubscription).not.toHaveBeenCalled();
    expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_unavailable", false);
  });

  it("articoli cambiati: nessuna PATCH, errore permanente", async () => {
    const d = deps({ getSubscription: vi.fn(async () => ({ ok: true as const, providerId: "sub_01x",
      subscription: subscription({ items: [paddleItem("pri_01team")] }) })) });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, failed: 1 });
    expect(d.patchSubscription).not.toHaveBeenCalled();
    expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_items_changed", true);
  });

  it("articoli già quelli d'arrivo (PATCH riuscita ma esito non registrato): applicata senza ripeterla", async () => {
    const d = deps({ getSubscription: vi.fn(async () => ({ ok: true as const, providerId: "sub_01x",
      subscription: subscription({ items: [paddleItem("pri_01base")] }) })) });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 1 });
    expect(d.patchSubscription).not.toHaveBeenCalled();
    expect(d.result).toHaveBeenCalledWith(ID, true, null, false);
  });

  it("PATCH rifiutata da Paddle: errore permanente; 429: si riprova", async () => {
    const rejected = deps({ patchSubscription: vi.fn(async () => ({ ok: false as const, status: 422 })) });
    await runScheduled(rejected, "https://k.test/app");
    expect(rejected.result).toHaveBeenCalledWith(ID, false, "paddle_rejected_422", true);
    const busy = deps({ patchSubscription: vi.fn(async () => ({ ok: false as const, status: 429 })) });
    await runScheduled(busy, "https://k.test/app");
    expect(busy.result).toHaveBeenCalledWith(ID, false, "paddle_unavailable", false);
  });

  // Cambio di ciclo (annuale → mensile): Paddle fa ripartire il periodo dalla
  // PATCH degli articoli, quindi una seconda PATCH rimette la data del rinnovo.
  const monthly = [{ price_id: "pri_01base_m", quantity: 1 }];
  const cycleRow = raw({ target_interval: "month", target_items: monthly });
  // Il periodo ripartito dalla nostra PATCH degli articoli, 15 ore e mezza prima del rinnovo.
  const restarted = { current_billing_period: { starts_at: "2026-11-17T08:00:00Z", ends_at: "2026-12-17T08:00:00Z" },
    next_billed_at: "2026-12-17T08:00:00Z" };
  const moved = restarted.next_billed_at;
  const monthlyItems = { items: [paddleItem("pri_01base_m")], billing_cycle: { interval: "month", frequency: 1 } };
  const reads = (...subs: Record<string, unknown>[]) => {
    const queue = [...subs];
    return vi.fn(async () => ({ ok: true as const, providerId: "sub_01x", subscription: queue.shift() ?? null }));
  };

  it("cambio di ciclo: PATCH degli articoli, poi PATCH della data, poi verifica", async () => {
    const d = deps({
      claim: vi.fn(async () => [cycleRow]),
      getSubscription: reads(subscription(),
        subscription({ items: [paddleItem("pri_01base_m")], billing_cycle: { interval: "month", frequency: 1 } })),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 1, retry: 0, failed: 0 });
    expect(d.patchSubscription.mock.calls).toEqual([
      ["sub_01x", { items: monthly, proration_billing_mode: "do_not_bill" }],
      ["sub_01x", { next_billed_at: EFFECTIVE, proration_billing_mode: "do_not_bill" }],
    ]);
    expect(d.getSubscription).toHaveBeenCalledTimes(2);
    expect(d.result).toHaveBeenCalledWith(ID, true, null, false);
  });

  it("cambio di ciclo: seconda PATCH fallita → si riprova con l'allarme «data non rimessa»", async () => {
    const write = vi.fn(async (_id: string, body: Record<string, unknown>) =>
      "items" in body ? { ok: true as const } : { ok: false as const, status: 409 });
    const d = deps({ claim: vi.fn(async () => [cycleRow]), getSubscription: reads(subscription()), patchSubscription: write });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, retry: 1, failed: 0 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_date_not_fixed", false);
  });

  it("cambio di ciclo: PATCH della data accettata ma la verifica non la trova → si riprova", async () => {
    const d = deps({
      claim: vi.fn(async () => [cycleRow]),
      getSubscription: reads(subscription(), subscription({ items: [paddleItem("pri_01base_m")], next_billed_at: moved })),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ retry: 1 });
    expect(d.patchSubscription).toHaveBeenCalledTimes(2);
    expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_date_not_fixed", false);
    const unread = deps({ claim: vi.fn(async () => [cycleRow]), getSubscription: vi.fn()
      .mockResolvedValueOnce({ ok: true, providerId: "sub_01x", subscription: subscription() })
      .mockResolvedValueOnce({ ok: false, status: 503 }) });
    await runScheduled(unread, "https://k.test/app");
    expect(unread.result).toHaveBeenCalledWith(ID, false, "paddle_date_not_fixed", false);
  });

  it("cambio di ciclo già a metà (articoli d'arrivo, data spostata): solo la PATCH della data", async () => {
    const half = subscription({ ...monthlyItems, ...restarted });
    const d = deps({
      claim: vi.fn(async () => [cycleRow]),
      getSubscription: reads(half, { ...half, next_billed_at: "2026-11-17T23:30:30Z" }),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 1, failed: 0 });
    expect(d.patchSubscription.mock.calls).toEqual([
      ["sub_01x", { next_billed_at: EFFECTIVE, proration_billing_mode: "do_not_bill" }],
    ]);
    expect(d.result).toHaveBeenCalledWith(ID, true, null, false);
  });

  it("cambio di ciclo già completo (articoli e data giusti): nessuna PATCH", async () => {
    const d = deps({
      claim: vi.fn(async () => [cycleRow]),
      getSubscription: reads(subscription({ items: [paddleItem("pri_01base_m")], billing_cycle: { interval: "month", frequency: 1 } })),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 1 });
    expect(d.patchSubscription).not.toHaveBeenCalled();
  });

  it("cambio di ciclo con la data spostata ma il periodo non ripartito dalla PATCH: si ferma, «data non rimessa» definitivo", async () => {
    // Rinnovo già avvenuto alla data d'effetto, o data spostata a mano prima della PATCH.
    // Gli articoli d'arrivo sono su Paddle: non è un «resta il piano attuale».
    const renewed = subscription({ ...monthlyItems, current_billing_period: { starts_at: EFFECTIVE, ends_at: "2026-12-17T23:30:00Z" },
      next_billed_at: "2026-12-17T23:30:00Z" });
    const earlier = subscription({ ...monthlyItems, ...restarted, next_billed_at: "2026-11-17T20:00:00Z" });
    for (const sub of [renewed, earlier]) {
      const d = deps({ claim: vi.fn(async () => [cycleRow]), getSubscription: reads(sub) });
      expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, failed: 1 });
      expect(d.patchSubscription).not.toHaveBeenCalled();
      expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_date_not_fixed_final", true);
    }
  });

  it("cambio di ciclo: PATCH della data rifiutata da Paddle (non si potrà mai) → «data non rimessa» definitivo", async () => {
    for (const status of [400, 404, 422]) {
      const write = vi.fn(async (_id: string, body: Record<string, unknown>) =>
        "items" in body ? { ok: true as const } : { ok: false as const, status });
      const d = deps({ claim: vi.fn(async () => [cycleRow]), getSubscription: reads(subscription()), patchSubscription: write });
      expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, retry: 0, failed: 1 });
      expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_date_not_fixed_final", true);
    }
  });

  it("ciclo invariato, articoli già d'arrivo e data diversa: si ferma, la data non si rimette", async () => {
    const d = deps({ getSubscription: reads(subscription({ items: [paddleItem("pri_01base")], ...restarted })) });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ applied: 0, failed: 1 });
    expect(d.patchSubscription).not.toHaveBeenCalled();
    expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_period_moved", true);
  });

  it("cambio di ciclo con il ciclo su Paddle illeggibile o diverso dalla richiesta: nessuna PATCH", async () => {
    for (const billing_cycle of [null, { interval: "month", frequency: 1 }]) {
      const d = deps({ claim: vi.fn(async () => [cycleRow]), getSubscription: reads(subscription({ billing_cycle })) });
      await runScheduled(d, "https://k.test/app");
      expect(d.patchSubscription).not.toHaveBeenCalled();
      expect(d.result).toHaveBeenCalledWith(ID, false, "paddle_period_moved", true);
    }
  });

  it("ciclo invariato: una sola PATCH, nessuna verifica", async () => {
    const d = deps();
    await runScheduled(d, "https://k.test/app");
    expect(d.patchSubscription).toHaveBeenCalledTimes(1);
    expect(d.getSubscription).toHaveBeenCalledTimes(1);
  });

  it("riga presa in carico ma illeggibile: chiusa, mai inviata", async () => {
    const d = deps({ claim: vi.fn(async () => [raw({ target_items: "x" })]) });
    await runScheduled(d, "https://k.test/app");
    expect(d.getSubscription).not.toHaveBeenCalled();
    expect(d.result).toHaveBeenCalledWith(ID, false, "invalid_row", true);
  });

  const queued = (over: Record<string, unknown> = {}, workspaceName: string | null = "Bar Sole"): QueuedEmail =>
    ({ row: raw(over), workspaceName });

  it("presa in carico fallita: le email partono lo stesso", async () => {
    const d = deps({ claim: vi.fn(async () => null), listReminderEmails: vi.fn(async () => [queued()]) });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ reminders: 1, error: "claim_failed" });
  });

  it("email: inviate, saltate senza destinatario, tentativo contato se fallite", async () => {
    const d = deps({
      claim: vi.fn(async () => []),
      listReminderEmails: vi.fn(async () => [queued({ id: "a" }), queued({ id: "b", requested_by: "nobody" })]),
      listAlertEmails: vi.fn(async () => [queued({ id: "c", alert_kind: "failed", alert_email_attempts: 2 })]),
      reminderRecipient: vi.fn(async (c: ScheduledChange) => c.requestedBy === "nobody" ? null : "titolare@example.test"),
      send: vi.fn(async (to: string) => to !== "info@example.test"),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ reminders: 1, skipped: 1, alerts: 0, emailFailed: 1 });
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.markReminder).toHaveBeenCalledWith("a", true, 0);
    expect(d.markReminder).toHaveBeenCalledWith("b", true, 0);
    expect(d.markAlert).toHaveBeenCalledWith("c", false, 2, "failed");
  });

  it("promemoria di un cambio annullato o fallito: segnato senza spedire", async () => {
    const d = deps({
      claim: vi.fn(async () => []),
      listReminderEmails: vi.fn(async () => [queued({ id: "x", status: "canceled" }), queued({ id: "y", status: "failed" })]),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ reminders: 0, skipped: 2 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.reminderRecipient).not.toHaveBeenCalled();
    expect(d.markReminder).toHaveBeenCalledWith("x", true, 0);
    expect(d.markReminder).toHaveBeenCalledWith("y", true, 0);
  });

  it("promemoria illeggibile: segnato, mai spedito, e il codice finisce nel log", async () => {
    const d = deps({
      claim: vi.fn(async () => []),
      listReminderEmails: vi.fn(async () => [queued({ id: "z", target_items: "x" })]),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ skipped: 1, error: "email_row_unreadable" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markReminder).toHaveBeenCalledWith("z", true, 0);
  });

  it("allarme su una riga illeggibile (invalid_row): parte lo stesso, ridotto", async () => {
    const d = deps({
      claim: vi.fn(async () => []),
      listAlertEmails: vi.fn(async () => [queued({ id: "w", alert_kind: "failed", last_error_code: "invalid_row",
        target_items: "x", from_items: null }, null)]),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ alerts: 1 });
    expect(d.send).toHaveBeenCalledWith("info@example.test", expect.objectContaining({
      subject: `[KlokShift] Cambio di piano da controllare: azienda ${WORKSPACE}`,
      text: expect.stringContaining("la richiesta registrata non è leggibile"),
    }));
    expect(d.markAlert).toHaveBeenCalledWith("w", true, 0, "failed");
  });

  it("allarme già rivisto dal fondatore: segnato senza spedire", async () => {
    const d = deps({
      claim: vi.fn(async () => []),
      listAlertEmails: vi.fn(async () => [queued({ id: "r", alert_kind: "not_sent", reviewed_at: "2026-11-17T10:00:00Z" })]),
    });
    expect(await runScheduled(d, "https://k.test/app")).toMatchObject({ alerts: 0, skipped: 1 });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.markAlert).toHaveBeenCalledWith("r", true, 0, "not_sent");
  });
});

describe("billing-scheduled: handler", () => {
  const imports = () => ({
    "npm:@supabase/supabase-js@2.117.0": { createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })) },
    "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient: vi.fn() },
  });

  it("senza il segreto delle push non fa nulla", async () => {
    const mods = imports();
    const edge = edgeRuntime("billing-scheduled", mods, { FOUNDER_ALERT_EMAIL: "info@example.test" });
    expect((await edge.handle(post({}))).status).toBe(401);
    expect((await edge.handle(post({}, { "x-push-secret": "sbagliato" }))).status).toBe(401);
    expect(mods["npm:@supabase/supabase-js@2.117.0"].createClient).not.toHaveBeenCalled();
  });

  it("invia il cambio preso in carico all'abbonamento Paddle giusto (email non configurate)", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "billing_scheduled_claim" ? [raw()] : null, error: null }));
    const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: { provider_subscription_id: "sub_01x" }, error: null }) }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));
    const fetch = vi.fn(async (_url: string, init: { method: string }) => new Response(JSON.stringify(
      init.method === "GET" ? { data: subscription() } : { data: {} }), { status: 200 }));
    const edge = edgeRuntime("billing-scheduled", {
      "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from, rpc }) },
      "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient: vi.fn() },
    }, { SMTP_HOST: undefined }, { fetch });
    const response = await edge.handle(post({}, { "x-push-secret": "fixture-push-secret" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: 1, reminders: 0, alerts: 0 });
    expect(rpc).toHaveBeenCalledWith("billing_scheduled_claim", { p_environment: "sandbox", p_limit: 10 });
    expect(eq).toHaveBeenCalledWith("id", SUB);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["https://sandbox-api.paddle.com/subscriptions/sub_01x", "GET"],
      ["https://sandbox-api.paddle.com/subscriptions/sub_01x", "PATCH"],
    ]);
    expect(JSON.parse((fetch.mock.calls[1][1] as unknown as { body: string }).body))
      .toEqual({ items: TARGET, proration_billing_mode: "do_not_bill" });
    expect(rpc).toHaveBeenCalledWith("billing_scheduled_result", { p_id: ID, p_ok: true, p_error: null, p_permanent: false });
  });

  it("allarme spedito: si segna solo se l'allarme è ancora quello letto", async () => {
    const updates: unknown[][][] = [];
    // Catena di query finta: legge i filtri e risponde alla fine (`await`).
    const from = vi.fn(() => {
      const calls: unknown[][] = [];
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => {
              if (calls.some(([m]) => m === "update")) { updates.push(calls); resolve({ error: null }); return; }
              const alerts = calls.some(([m, col]) => m === "not" && col === "alert_kind");
              resolve({ data: alerts ? [{ ...raw({ id: "c", alert_kind: "failed" }), workspace: { name: "Bar Sole" } }] : [], error: null });
            };
          }
          return (...args: unknown[]) => { calls.push([prop, ...args]); return chain; };
        },
      });
      return chain;
    });
    const send = vi.fn(async () => undefined);
    const edge = edgeRuntime("billing-scheduled", {
      "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from, rpc: vi.fn() }) },
      "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient: class { send = send; close = vi.fn(); } },
    }, { FOUNDER_ALERT_EMAIL: "info@example.test", PADDLE_API_KEY: undefined });
    const response = await edge.handle(post({}, { "x-push-secret": "fixture-push-secret" }));
    expect(await response.json()).toMatchObject({ alerts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContainEqual(["eq", "id", "c"]);
    // Un'escalation concorrente (failed → renewal_mismatch) non risulta spedita.
    expect(updates[0]).toContainEqual(["eq", "alert_kind", "failed"]);
  });

  it("cambio di ciclo: GET, PATCH degli articoli, PATCH della data, GET di verifica", async () => {
    const monthly = [{ price_id: "pri_01base_m", quantity: 1 }];
    const rpc = vi.fn(async (name: string) => ({
      data: name === "billing_scheduled_claim" ? [raw({ target_interval: "month", target_items: monthly })] : null, error: null }));
    const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: { provider_subscription_id: "sub_01x" }, error: null }) }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));
    let gets = 0;
    const fetch = vi.fn(async (_url: string, init: { method: string }) => new Response(JSON.stringify(
      init.method === "GET"
        ? { data: gets++ === 0 ? subscription() : subscription({ items: [paddleItem("pri_01base_m")],
          billing_cycle: { interval: "month", frequency: 1 } }) }
        : { data: {} }), { status: 200 }));
    const edge = edgeRuntime("billing-scheduled", {
      "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from, rpc }) },
      "https://deno.land/x/denomailer@1.6.0/mod.ts": { SMTPClient: vi.fn() },
    }, { SMTP_HOST: undefined }, { fetch });
    const response = await edge.handle(post({}, { "x-push-secret": "fixture-push-secret" }));
    expect(await response.json()).toMatchObject({ applied: 1 });
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "PATCH", "PATCH", "GET"]);
    const bodies = fetch.mock.calls.filter(([, init]) => init.method === "PATCH")
      .map(([, init]) => JSON.parse((init as unknown as { body: string }).body));
    expect(bodies).toEqual([
      { items: monthly, proration_billing_mode: "do_not_bill" },
      { next_billed_at: EFFECTIVE, proration_billing_mode: "do_not_bill" },
    ]);
  });
});
