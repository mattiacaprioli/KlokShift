// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.
// `paddleConfig` è la copia di quello di `billing-manage` (stesse regole).

export type BillingEnvironment = "sandbox" | "live";
export type Item = { price_id: string; quantity: number };
export type Mail = { subject: string; text: string; html: string };
export type AlertKind = "not_sent" | "failed" | "renewal_mismatch" | "date_not_fixed" | "renewal_overdue";
// Gemello del CHECK di `billing_scheduled_changes.alert_kind`.
const ALERT_KINDS: readonly unknown[] = ["not_sent", "failed", "renewal_mismatch", "date_not_fixed", "renewal_overdue"];

/** Chiave API e ambiente dello stesso account Paddle (vedi `billing-checkout`). */
export function paddleConfig(env: {
  environment?: string; apiKey?: string;
}): { environment: BillingEnvironment; apiKey: string; apiBase: string } | null {
  const { environment, apiKey } = env;
  if (environment === "sandbox" && apiKey?.startsWith("pdl_sdbx_apikey_")) {
    return { environment, apiKey, apiBase: "https://sandbox-api.paddle.com" };
  }
  if (environment === "live" && apiKey?.startsWith("pdl_live_apikey_")) {
    return { environment, apiKey, apiBase: "https://api.paddle.com" };
  }
  return null;
}

export type ScheduledChange = {
  id: string;
  subscriptionId: string;
  workspaceId: string;
  requestedBy: string;
  targetPlan: "base" | "team";
  targetInterval: "month" | "year";
  targetExtraVenues: number;
  /** Il ciclo alla richiesta: diverso da `targetInterval` vuol dire cambio di ciclo. */
  fromInterval: "month" | "year";
  fromItems: Item[];
  targetItems: Item[];
  renewalCents: number;
  currency: string;
  effectiveAt: string;
  alertKind: AlertKind | null;
  lastErrorCode: string | null;
};

function parseItems(value: unknown): Item[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: Item[] = [];
  for (const raw of value) {
    const item = raw as { price_id?: unknown; quantity?: unknown } | null;
    if (!item || typeof item.price_id !== "string" || typeof item.quantity !== "number" ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1) return null;
    items.push({ price_id: item.price_id, quantity: item.quantity });
  }
  return items;
}

/** Riga di `billing_scheduled_changes` letta dal database; una riga strana non si invia. */
export function parseScheduledChange(raw: Record<string, unknown>): ScheduledChange | null {
  const fromItems = parseItems(raw.from_items);
  const targetItems = parseItems(raw.target_items);
  const alertKind = raw.alert_kind ?? null;
  if (typeof raw.id !== "string" || typeof raw.subscription_id !== "string" || typeof raw.workspace_id !== "string" ||
      typeof raw.requested_by !== "string" || (raw.target_plan !== "base" && raw.target_plan !== "team") ||
      (raw.target_interval !== "month" && raw.target_interval !== "year") ||
      typeof raw.target_extra_venues !== "number" ||
      (raw.from_interval !== "month" && raw.from_interval !== "year") || !fromItems || !targetItems ||
      typeof raw.renewal_cents !== "number" || typeof raw.currency !== "string" ||
      typeof raw.effective_at !== "string" || !Number.isFinite(Date.parse(raw.effective_at)) ||
      (alertKind !== null && !ALERT_KINDS.includes(alertKind))) {
    return null;
  }
  return {
    id: raw.id, subscriptionId: raw.subscription_id, workspaceId: raw.workspace_id, requestedBy: raw.requested_by,
    targetPlan: raw.target_plan, targetInterval: raw.target_interval, targetExtraVenues: raw.target_extra_venues,
    fromInterval: raw.from_interval, fromItems, targetItems, renewalCents: raw.renewal_cents, currency: raw.currency, effectiveAt: raw.effective_at,
    alertKind: alertKind as AlertKind | null,
    lastErrorCode: typeof raw.last_error_code === "string" ? raw.last_error_code : null,
  };
}

/** Gli articoli ricorrenti attivi letti da Paddle, ordinati; `null` se non si riconoscono. */
function activeItems(current: unknown): Item[] | null {
  if (!Array.isArray(current)) return null;
  const items: Item[] = [];
  for (const raw of current) {
    const item = raw as { price?: { id?: unknown }; quantity?: unknown; status?: unknown; recurring?: unknown };
    if (item.status === "inactive" || item.recurring === false) continue;
    if (typeof item.price?.id !== "string" || typeof item.quantity !== "number") return null;
    items.push({ price_id: item.price.id, quantity: item.quantity });
  }
  return sortItems(items);
}

const sortItems = (items: Item[]) => [...items].sort((a, b) =>
  a.price_id < b.price_id ? -1 : a.price_id > b.price_id ? 1 : a.quantity - b.quantity);

const sameItems = (a: Item[] | null, b: Item[]) =>
  a !== null && JSON.stringify(a) === JSON.stringify(sortItems(b));

export type TargetProblem = "paddle_not_active" | "paddle_period_moved" | "paddle_items_changed";

/**
 * L'abbonamento letto da Paddle deve essere quello su cui il titolare ha
 * deciso: attivo e senza altri cambi programmati, stesso rinnovo (±120 s),
 * stesso ciclo, stessi articoli della richiesta. Altrimenti non si invia: non
 * si improvvisa. Un ciclo illeggibile o diverso da quello della richiesta è un
 * periodo che non torna (`paddle_period_moved`): si scopre prima della PATCH
 * degli articoli, mai dopo.
 */
export function checkScheduledTarget(sub: unknown,
  row: { effectiveAt: string; fromInterval: "month" | "year"; fromItems: Item[] }): TargetProblem | null {
  const data = sub as { status?: unknown; scheduled_change?: unknown; next_billed_at?: unknown; items?: unknown } | null;
  // Una pausa o disdetta programmata su Paddle chiude il cambio dall'avviso: qui ci si ferma.
  if (!data || data.status !== "active" || (data.scheduled_change !== null && data.scheduled_change !== undefined)) {
    return "paddle_not_active";
  }
  if (!renewsAt(data, row.effectiveAt) || currentInterval(data) !== row.fromInterval) return "paddle_period_moved";
  return sameItems(activeItems(data.items), row.fromItems) ? null : "paddle_items_changed";
}

/** Su Paddle il prossimo rinnovo coincide (±120 s) con la data d'effetto. */
export function renewsAt(sub: unknown, effectiveAt: string): boolean {
  const value = (sub as { next_billed_at?: unknown } | null)?.next_billed_at;
  const next = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(next) && Math.abs(next - Date.parse(effectiveAt)) <= 120_000;
}

/**
 * Il periodo su Paddle è ripartito dalla nostra PATCH degli articoli (cambio di
 * ciclo a metà): è cominciato più di 30 minuti prima della data d'effetto (il
 * blocco di Paddle prima del rinnovo) e il prossimo rinnovo è oltre. Un
 * rinnovo già avvenuto comincia alla data d'effetto, e non si tocca.
 */
export function restartedBeforeRenewal(sub: unknown, effectiveAt: string): boolean {
  const data = sub as { next_billed_at?: unknown; current_billing_period?: { starts_at?: unknown } | null } | null;
  const effective = Date.parse(effectiveAt);
  const next = typeof data?.next_billed_at === "string" ? Date.parse(data.next_billed_at) : NaN;
  const starts = typeof data?.current_billing_period?.starts_at === "string"
    ? Date.parse(data.current_billing_period.starts_at) : NaN;
  return next > effective && starts < effective - 30 * 60_000;
}

/** Il ciclo attuale su Paddle (`billing_cycle.interval`); null se non si legge. */
export function currentInterval(sub: unknown): "month" | "year" | null {
  const value = (sub as { billing_cycle?: { interval?: unknown } | null } | null)?.billing_cycle?.interval;
  return value === "month" || value === "year" ? value : null;
}

/** Gli articoli su Paddle sono già quelli d'arrivo (un invio riuscito ma non registrato). */
export function alreadyApplied(sub: unknown, targetItems: Item[]): boolean {
  return sameItems(activeItems((sub as { items?: unknown } | null)?.items), targetItems);
}

/** Il cambio vale dal rinnovo: niente addebito né accredito adesso. */
export function scheduledPatchBody(items: Item[]) {
  return { items, proration_billing_mode: "do_not_bill" };
}

/**
 * Seconda PATCH di un cambio di ciclo. Paddle fa ripartire il periodo dalla
 * PATCH degli articoli (docs/TEST-BILLING-SCHEDULED.md §3 bis) e non accetta
 * articoli e data insieme: la data del rinnovo si rimette da sola, senza
 * addebito. Nel formato provato in sandbox: UTC, `Z`, secondi interi (le
 * frazioni si troncano; il confronto resta ±120 s, il reconcile 5 minuti).
 */
export function scheduledDateBody(effectiveAt: string) {
  return { next_billed_at: new Date(effectiveAt).toISOString().replace(/\.\d{3}Z$/, "Z"), proration_billing_mode: "do_not_bill" };
}

export type ScheduledPatch = ReturnType<typeof scheduledPatchBody> | ReturnType<typeof scheduledDateBody>;

/**
 * Codice di una risposta HTTP di Paddle (0 = non raggiungibile). 400, 404 e
 * 422 dicono che la richiesta non andrà mai bene: si chiude e si avvisa. Il
 * resto (5xx, 429, altri 4xx come un blocco temporaneo) si riprova.
 */
export function paddleErrorCode(status: number): string {
  return status === 400 || status === 404 || status === 422 ? `paddle_rejected_${status}` : "paddle_unavailable";
}

/**
 * `paddle_date_not_fixed_final`: cambio di ciclo con gli articoli d'arrivo su
 * Paddle e la data del rinnovo che da qui non si può più rimettere. Il
 * database chiude con l'allarme `date_not_fixed` e non avvisa il titolare.
 */
const PERMANENT: readonly string[] = ["paddle_not_active", "paddle_period_moved", "paddle_items_changed", "invalid_row",
  "paddle_date_not_fixed_final"];

export function isPermanent(code: string): boolean {
  return PERMANENT.includes(code) || code.startsWith("paddle_rejected_");
}

// --- Email ---

const romeDate = (at: string) =>
  new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" })
    .format(new Date(at));

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** «290,00 €», con spazi normali: Intl usa spazi non separabili. */
function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(cents / 100)
      .replace(/[  ]/g, " ");
  } catch {
    return `${(cents / 100).toFixed(2).replace(".", ",")} ${currency}`;
  }
}

type TargetFields = Pick<ScheduledChange, "targetPlan" | "targetInterval" | "targetExtraVenues" | "renewalCents" | "currency">;

/** «Base, annuale, 2 sedi», il punto d'arrivo in parole. */
function target(row: TargetFields) {
  const venues = 1 + row.targetExtraVenues;
  return {
    plan: row.targetPlan === "base" ? "Base" : "Team",
    interval: row.targetInterval === "year" ? "annuale" : "mensile",
    venues: `${venues} ${venues === 1 ? "sede" : "sedi"}`,
    amount: `${money(row.renewalCents, row.currency)} IVA compresa`,
  };
}

function mail(subject: string, paragraphs: string[], link: string): Mail {
  const html = paragraphs.map((p) => `<p>${escapeHtml(p).replace(escapeHtml(link), `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`)
    .replace(/\n/g, "<br>")}</p>`).join("\n");
  return { subject, text: paragraphs.join("\n\n"), html };
}

/** Promemoria al titolare che ha chiesto il cambio, 7 giorni prima. */
export function formatReminder(row: ScheduledChange, workspaceName: string, dashboardUrl: string): Mail {
  const name = oneLine(workspaceName);
  const date = romeDate(row.effectiveAt);
  const link = `${dashboardUrl.replace(/\/$/, "")}/#/piano`;
  const t = target(row);
  return mail(`Dal ${date} cambia l'abbonamento di ${name}`, [
    `Ciao,\ndal rinnovo del ${date} l'abbonamento di ${name} su KlokShift cambia come hai chiesto dalla pagina Piano.`,
    `Piano: ${t.plan}\nCiclo: ${t.interval}\nSedi: ${t.venues}\nImporto del rinnovo: ${t.amount}`,
    `Fino a 24 ore prima del rinnovo puoi annullare il cambio dalla pagina Piano:\n${link}`,
    "Per qualsiasi domanda scrivi a info@klokshift.com.\n\nKlokShift",
  ], link);
}

/** Il motivo dell'errore in italiano; un codice sconosciuto si dice com'è. */
function errorReason(code: string | null): string | null {
  if (!code) return null;
  if (code === "paddle_not_active") return "su Paddle l'abbonamento non è attivo o ha già un altro cambio programmato";
  if (code === "paddle_period_moved") return "su Paddle la data del rinnovo non coincide più con quella del cambio";
  if (code === "paddle_items_changed") return "su Paddle gli articoli dell'abbonamento non sono più quelli della richiesta";
  if (code === "paddle_date_not_fixed") return "il ciclo è cambiato su Paddle ma la data del rinnovo non è stata rimessa";
  if (code === "paddle_date_not_fixed_final") return "il ciclo è cambiato su Paddle ma la data del rinnovo da qui non si può più rimettere";
  if (code === "paddle_unavailable") return "Paddle non ha risposto o ha chiesto di riprovare più tardi";
  if (code.startsWith("paddle_rejected_")) return `Paddle ha rifiutato la richiesta (HTTP ${code.slice("paddle_rejected_".length)})`;
  if (code === "billing_scheduled_people") return "l'azienda ha più persone di quante ne ammetta il piano d'arrivo";
  if (code === "billing_scheduled_venues") return "l'azienda ha più sedi di quelle del cambio";
  if (code === "invalid_row") return "la richiesta registrata non è leggibile";
  return "le condizioni del cambio non valgono più";
}

/** Quanto serve all'allarme. Lettura indulgente: l'allarme parte anche se la riga è in parte illeggibile. */
export type AlertInfo = {
  id: string;
  workspaceId: string;
  effectiveAt: string;
  alertKind: AlertKind;
  lastErrorCode: string | null;
  /** Motivo di chiusura: un `renewal_mismatch` senza rinnovo è un esito arrivato su una riga già chiusa. */
  closeReason: string | null;
  /** Il punto d'arrivo, se leggibile. */
  target: TargetFields | null;
};

/** Riga in allarme: bastano id, azienda, data e tipo; il punto d'arrivo è facoltativo. */
export function parseAlert(raw: Record<string, unknown>): AlertInfo | null {
  const { id, workspace_id, effective_at, alert_kind, last_error_code, close_reason } = raw;
  if (typeof id !== "string" || typeof workspace_id !== "string" || typeof effective_at !== "string" ||
      !Number.isFinite(Date.parse(effective_at)) ||
      !ALERT_KINDS.includes(alert_kind)) return null;
  const { target_plan, target_interval, target_extra_venues, renewal_cents, currency } = raw;
  const target = (target_plan === "base" || target_plan === "team") &&
      (target_interval === "month" || target_interval === "year") &&
      typeof target_extra_venues === "number" && typeof renewal_cents === "number" && typeof currency === "string"
    ? { targetPlan: target_plan, targetInterval: target_interval, targetExtraVenues: target_extra_venues,
      renewalCents: renewal_cents, currency } as TargetFields
    : null;
  return { id, workspaceId: workspace_id, effectiveAt: effective_at, alertKind: alert_kind as AlertKind,
    lastErrorCode: typeof last_error_code === "string" ? last_error_code : null,
    closeReason: typeof close_reason === "string" ? close_reason : null, target };
}

/** Allarme al fondatore: un cambio non arrivato a Paddle o un rinnovo diverso. */
export function formatAlert(row: AlertInfo, workspaceName: string, dashboardUrl: string): Mail {
  const name = oneLine(workspaceName);
  const date = romeDate(row.effectiveAt);
  const link = `${dashboardUrl.replace(/\/$/, "")}/#/amministrazione/aziende/${row.workspaceId}`;
  const t = row.target ? target(row.target) : null;
  const opening = row.alertKind === "not_sent"
    ? `il cambio di piano di ${name} non è ancora arrivato a Paddle e mancano meno di 6 ore al rinnovo.`
    : row.alertKind === "renewal_mismatch" && row.closeReason !== "renewal_mismatch"
    ? `il cambio di piano di ${name} è arrivato a Paddle, ma qui risultava già chiuso: controlla su Paddle articoli e data del rinnovo.`
    : row.alertKind === "renewal_mismatch"
    ? `il rinnovo di ${name} è avvenuto con articoli diversi da quelli programmati.`
    : row.alertKind === "renewal_overdue"
    ? `il cambio di piano di ${name} è ancora aperto, ma la data del rinnovo è passata da più di due ore senza avviso da Paddle: controlla su Paddle data e articoli.`
    : row.alertKind === "date_not_fixed"
    ? `il cambio di ciclo di ${name} è arrivato a Paddle, ma il rinnovo non è più al ${date}: finché la data non torna quella, Paddle non addebita nel giorno giusto.`
    : `il cambio di piano di ${name} non è stato inviato a Paddle e non partirà da solo: il rinnovo avverrà col piano attuale.`;
  const reason = row.alertKind === "renewal_overdue"
    ? "Paddle non ha rinnovato alla data del cambio" : errorReason(row.lastErrorCode);
  const code = row.alertKind === "renewal_overdue" || !row.lastErrorCode ? "" : ` (codice ${row.lastErrorCode})`;
  return mail(`[KlokShift] Cambio di piano da controllare: ${name}`, [
    `Ciao,\n${opening}`,
    ...(reason ? [`Motivo: ${reason}${code}.`] : []),
    `Rinnovo: ${date}\nPunto d'arrivo: ${t ? `${t.plan}, ${t.interval}, ${t.venues}, ${t.amount}` : "non leggibile, vedi la scheda"}`,
    `Dalla scheda dell'azienda puoi riprovare l'invio o chiudere l'avviso con una nota:\n${link}`,
    "KlokShift",
  ], link);
}

// --- Esecuzione ---

export type PaddleRead = { ok: true; providerId: string; subscription: unknown } | { ok: false; status: number };
export type PaddleWrite = { ok: true } | { ok: false; status: number };
/** Riga con un'email in attesa, così come letta dalla tabella (con `status` e `reviewed_at`). */
export type QueuedEmail = { row: Record<string, unknown>; workspaceName: string | null };

export type ScheduledDeps = {
  /** Righe già prese in carico dal database (`billing_scheduled_claim`); null se la lettura fallisce. */
  claim(): Promise<Record<string, unknown>[] | null>;
  /** Abbonamento su Paddle dal nostro id (`billing_subscriptions.id`). */
  getSubscription(subscriptionId: string): Promise<PaddleRead>;
  patchSubscription(providerId: string, body: ScheduledPatch): Promise<PaddleWrite>;
  /** `billing_scheduled_result`. */
  result(id: string, ok: boolean, error: string | null, permanent: boolean): Promise<boolean>;
  listReminderEmails(): Promise<QueuedEmail[] | null>;
  listAlertEmails(): Promise<QueuedEmail[] | null>;
  /** L'indirizzo per il promemoria; null = nessuno a cui scrivere, undefined = lettura fallita (si riprova). */
  reminderRecipient(change: ScheduledChange): Promise<string | null | undefined>;
  /** Destinatario degli allarmi (`FOUNDER_ALERT_EMAIL`). */
  founderEmail: string | null;
  send(to: string, mail: Mail): Promise<boolean>;
  /** `sent` true segna l'email come fatta; false conta un tentativo in più. */
  markReminder(id: string, sent: boolean, attempts: number): Promise<boolean>;
  /** Come `markReminder`, solo se l'allarme è ancora `kind`: un'escalation concorrente non risulta spedita. */
  markAlert(id: string, sent: boolean, attempts: number, kind: AlertKind): Promise<boolean>;
};

export type ScheduledRun = {
  applied: number; failed: number; retry: number;
  reminders: number; alerts: number; skipped: number; emailFailed: number;
  error?: string;
};

/**
 * Un cambio preso in carico: GET → confronto → PATCH; l'esito lo registra il
 * database. Un cambio di ciclo vuole una seconda PATCH con la data del rinnovo
 * e una GET che la verifichi; se la data non torna si riprova, con l'allarme
 * `date_not_fixed`, e la PATCH degli articoli non si ripete.
 */
async function sendOne(deps: ScheduledDeps, raw: Record<string, unknown>): Promise<"applied" | "failed" | "retry" | null> {
  const row = parseScheduledChange(raw);
  if (!row) {
    if (typeof raw.id !== "string") return null;
    return (await deps.result(raw.id, false, "invalid_row", true)) ? "failed" : null;
  }
  const report = async (error: string | null) => {
    const permanent = error !== null && isPermanent(error);
    const ok = await deps.result(row.id, error === null, error, permanent);
    return ok ? (error === null ? "applied" : permanent ? "failed" : "retry") : null;
  };

  const read = await deps.getSubscription(row.subscriptionId);
  if (!read.ok) return report(paddleErrorCode(read.status));
  const fixDate = async () => {
    const write = await deps.patchSubscription(read.providerId, scheduledDateBody(row.effectiveAt));
    // Rifiutata (400, 404, 422): non andrà mai bene, e riprovare non serve.
    if (!write.ok) {
      return report(isPermanent(paddleErrorCode(write.status)) ? "paddle_date_not_fixed_final" : "paddle_date_not_fixed");
    }
    const check = await deps.getSubscription(row.subscriptionId);
    return report(check.ok && renewsAt(check.subscription, row.effectiveAt) ? null : "paddle_date_not_fixed");
  };

  // Il cambio di ciclo lo dice la riga, non Paddle.
  const cycleChange = row.fromInterval !== row.targetInterval;
  const problem = checkScheduledTarget(read.subscription, row);
  // Gli articoli sono già quelli d'arrivo: una PATCH riuscita ma non
  // registrata (timeout), o un cambio di ciclo a metà. Si guarda prima del
  // confronto con `from_items`, che li darebbe per «cambiati».
  if (problem !== "paddle_not_active" && alreadyApplied(read.subscription, row.targetItems)) {
    if (renewsAt(read.subscription, row.effectiveAt)) return report(null);
    // La data si rimette solo se l'ha spostata la nostra PATCH di un cambio di
    // ciclo. A ciclo invariato Paddle la tiene: una data diversa viene da fuori
    // (modifica a mano, rinnovo già avvenuto) e rimetterla sposterebbe
    // l'addebito del cliente, o lo ripeterebbe subito. Un cambio di ciclo con
    // gli articoli su Paddle e la data che non si può rimettere non è un
    // «resta il piano attuale»: allarme `date_not_fixed` definitivo.
    if (!cycleChange) return report("paddle_period_moved");
    return restartedBeforeRenewal(read.subscription, row.effectiveAt)
      ? fixDate() : report("paddle_date_not_fixed_final");
  }
  if (problem) return report(problem);
  const write = await deps.patchSubscription(read.providerId, scheduledPatchBody(row.targetItems));
  if (!write.ok) return report(paddleErrorCode(write.status));
  // Stesso ciclo: Paddle tiene la data. Cambio di ciclo: la si rimette.
  return cycleChange ? fixDate() : report(null);
}

/** Invia i cambi presi in carico, poi le email in attesa. Restituisce i conteggi. */
export async function runScheduled(deps: ScheduledDeps, dashboardUrl: string): Promise<ScheduledRun> {
  const out: ScheduledRun = { applied: 0, failed: 0, retry: 0, reminders: 0, alerts: 0, skipped: 0, emailFailed: 0 };
  const errors: string[] = [];

  const claimed = await deps.claim();
  if (!claimed) errors.push("claim_failed");
  for (const raw of claimed ?? []) {
    const outcome = await sendOne(deps, raw);
    if (outcome) out[outcome]++; else errors.push("result_failed");
  }

  // Email che non vanno più spedite: si segnano come fatte senza inviarle.
  const handled = async (mark: () => Promise<boolean>, kind: string) => {
    out.skipped++;
    if (!(await mark())) errors.push(`${kind}_mark_failed`);
  };
  const deliver = async (to: string, mail: Mail, kind: "reminders" | "alerts",
    mark: (sent: boolean) => Promise<boolean>) => {
    const sent = await deps.send(to, mail);
    if (sent) out[kind]++; else out.emailFailed++;
    if (!(await mark(sent))) errors.push(`${kind}_mark_failed`);
  };
  const attemptsOf = (value: unknown) => typeof value === "number" ? value : 0;

  const reminders = await deps.listReminderEmails();
  if (!reminders) errors.push("reminders_read_failed");
  for (const q of reminders ?? []) {
    const id = q.row.id;
    if (typeof id !== "string") { errors.push("email_row_unreadable"); continue; }
    const attempts = attemptsOf(q.row.reminder_email_attempts);
    const mark = (sent: boolean) => deps.markReminder(id, sent, attempts);
    const change = parseScheduledChange(q.row);
    // Una riga illeggibile non diventa un'email sbagliata al titolare.
    if (!change || q.workspaceName === null) {
      errors.push("email_row_unreadable");
      await handled(() => mark(true), "reminders");
      continue;
    }
    // Annullato o fallito dopo la notifica: il cambio non avverrà, niente «Dal … cambia».
    if (q.row.status !== "pending" && q.row.status !== "applied") { await handled(() => mark(true), "reminders"); continue; }
    const to = await deps.reminderRecipient(change);
    if (to === undefined) { errors.push("recipient_read_failed"); continue; }
    // Chi ha chiesto il cambio non è più titolare attivo con email confermata.
    if (to === null) { await handled(() => mark(true), "reminders"); continue; }
    await deliver(to, formatReminder(change, q.workspaceName, dashboardUrl), "reminders", mark);
  }

  const alerts = await deps.listAlertEmails();
  if (!alerts) errors.push("alerts_read_failed");
  for (const q of alerts ?? []) {
    // Lettura indulgente: un allarme non si perde perché la riga è in parte illeggibile.
    const alert = parseAlert(q.row);
    if (!alert) { errors.push("email_row_unreadable"); continue; }
    const attempts = attemptsOf(q.row.alert_email_attempts);
    const mark = (sent: boolean) => deps.markAlert(alert.id, sent, attempts, alert.alertKind);
    // Il fondatore l'ha già visto e chiuso nel pannello.
    if (q.row.reviewed_at !== null && q.row.reviewed_at !== undefined) { await handled(() => mark(true), "alerts"); continue; }
    if (!deps.founderEmail) { errors.push("founder_email_missing"); break; }
    await deliver(deps.founderEmail, formatAlert(alert, q.workspaceName ?? `azienda ${alert.workspaceId}`, dashboardUrl),
      "alerts", mark);
  }

  if (errors.length > 0) out.error = [...new Set(errors)].join(",");
  return out;
}
