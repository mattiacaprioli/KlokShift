// Helper locali alla funzione: nessun import dal bundle dell'app o tra deploy.

export type ReminderKind = "started" | "30_days" | "7_days";
export type Reminder = {
  id: string; kind: ReminderKind; archiveUntil: string; workspaceName: string; email: string; attempts: number;
};
export type Mail = { subject: string; text: string; html: string };

const KINDS: readonly ReminderKind[] = ["started", "30_days", "7_days"];

/** Riga della coda letta dal database; una riga strana non si spedisce. */
export function parseReminder(raw: Record<string, unknown>): Reminder | null {
  const { id, kind, archive_until, workspace_name, email, email_attempts } = raw;
  if (typeof id !== "string" || !KINDS.includes(kind as ReminderKind) || typeof archive_until !== "string" ||
      !Number.isFinite(Date.parse(archive_until)) || typeof workspace_name !== "string" ||
      typeof email !== "string" || !email.includes("@") || typeof email_attempts !== "number") return null;
  return { id, kind: kind as ReminderKind, archiveUntil: archive_until, workspaceName: workspace_name,
    email, attempts: email_attempts };
}

const romeDate = (at: string) =>
  new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" })
    .format(new Date(at));

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Testo del promemoria. Il link porta alla pagina Piano della dashboard (export e riattivazione). */
export function reminderMail(r: Reminder, dashboardUrl: string): Mail {
  const name = r.workspaceName.replace(/[\r\n]+/g, " ").trim();
  const date = romeDate(r.archiveUntil);
  const link = `${dashboardUrl.replace(/\/$/, "")}/#/piano`;
  const subject = r.kind === "started" ? `${name}: l'archivio resta consultabile fino al ${date}`
    : r.kind === "30_days" ? `${name}: l'archivio scade il ${date}`
    : `${name}: fra 7 giorni i dati vengono cancellati`;
  const opening = r.kind === "started"
    ? `${name} su KlokShift non è più attiva.`
    : r.kind === "30_days" ? `l'archivio di ${name} su KlokShift scade il ${date}.`
    : `fra 7 giorni, dopo il ${date}, i dati di ${name} su KlokShift vengono cancellati.`;
  const paragraphs = [
    `Ciao,\n${opening}`,
    `Fino al ${date} chi gestisce l'azienda può consultare ed esportare turni, presenze e ore, assenze e documenti dalla dashboard:\n${link}`,
    "Dopo quella data vengono cancellati i dati operativi dell'azienda: sedi, turni, presenze e ore, assenze, schede del personale, documenti e chat. Gli account delle persone restano.",
    "Per tornare a lavorare puoi riattivare l'abbonamento dalla stessa pagina: ritrovi i dati come li hai lasciati.",
    "Per qualsiasi domanda scrivi a info@klokshift.com.\n\nKlokShift",
  ];
  const html = paragraphs.map((p) => `<p>${escapeHtml(p).replace(escapeHtml(link), `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`)
    .replace(/\n/g, "<br>")}</p>`).join("\n");
  return { subject, text: paragraphs.join("\n\n"), html };
}

export type ReminderDeps = {
  listPending(limit: number): Promise<Reminder[] | null>;
  send(to: string, mail: Mail): Promise<boolean>;
  markSent(id: string): Promise<boolean>;
  markFailed(r: Reminder): Promise<boolean>;
};

/** Spedisce la coda: una riga esce solo a invio riuscito; un errore conta un tentativo. */
export async function runReminders(deps: ReminderDeps, dashboardUrl: string, limit = 50) {
  const pending = await deps.listPending(limit);
  if (!pending) return { sent: 0, failed: 0, error: "queue_read_failed" };
  let sent = 0;
  let failed = 0;
  for (const r of pending) {
    if (await deps.send(r.email, reminderMail(r, dashboardUrl))) {
      sent++;
      if (!(await deps.markSent(r.id))) return { sent, failed, error: "queue_mark_failed" };
    } else {
      failed++;
      await deps.markFailed(r);
    }
  }
  return { sent, failed };
}
