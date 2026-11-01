import { isShiftOver, type ShiftTimes } from "@/lib/format";

/**
 * Bozze di turno: un turno con `published_at` nullo non lo vede nessuno oltre
 * a chi gestisce, e non avvisa. Regole pure e frasi, senza React Native: le
 * usano app, dashboard e i gemelli di `notify.ts` / `moveImpact.ts`.
 *
 * Il default del database è «pubblicato»: la bozza nasce solo da una scelta
 * esplicita (`draft: true` nel piano di `create_shifts`).
 */

export const DRAFT_LABEL = "Bozza";
export const EXPIRED_DRAFT_LABEL = "Mai pubblicato";
export const SAVE_DRAFT = "Salva in bozza";
export const SAVE_AND_PUBLISH = "Salva e pubblica";
export const CONFIRM_ALL = "Conferma tutti";
export const RECORD_DRAFT = "Registra come fatto";
export const DRAFT_SILENT_LINE =
  "È una bozza: nessuno viene avvisato finché non la pubblichi.";
export const DUPLICATE_AS_DRAFT =
  "Le copie restano in bozza finché non le pubblichi.";

/** Il vuoto dell'agenda di chi può creare turni: la notifica parte alla pubblicazione. */
export const EMPTY_SHIFTS_HINT =
  "Scegli giorno, orario e chi lavora: le persone lo vedono e ricevono la notifica quando pubblichi.";

export function isDraft(shift: { published_at: string | null }): boolean {
  return shift.published_at === null;
}

/** Una bozza il cui orario è già finito: non si pubblica più, resta «mai pubblicata». */
export function isExpiredDraft(
  shift: { published_at: string | null } & ShiftTimes,
  now: Date = new Date()
): boolean {
  return isDraft(shift) && isShiftOver(shift, now);
}

/** Risposta di `get_publish_preview`, con `shifts` che è un conteggio. */
export type PublishPreview = {
  shift_ids: string[];
  shifts: number;
  people: number;
  /**
   * Persone nei turni, con o senza account, chi pubblica compreso; e se chi
   * pubblica è fra loro. Servono a dire *perché* non si avvisa nessuno
   * (20261103000500). Facoltativi: un server più vecchio non li manda.
   */
  assignees?: number;
  self?: boolean;
  outside: number;
  expired: number;
};

/**
 * L'avviso delle bozze dimenticate: «12 turni in bozza (dicembre)», con in coda
 * quelle ormai finite. Null se non c'è niente da dire.
 */
export function draftsBannerText(input: {
  upcoming: number;
  expired: number;
  months: string[];
}): string | null {
  const { upcoming, expired, months } = input;
  const parts: string[] = [];
  if (upcoming > 0) {
    const where = months.length > 0 ? ` (${months.join(", ")})` : "";
    parts.push(
      `${upcoming} ${upcoming === 1 ? "turno" : "turni"} in bozza${where}`
    );
  }
  if (expired > 0) {
    parts.push(`${expired} mai ${expired === 1 ? "pubblicato" : "pubblicati"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Il comando di pubblicazione nell'intestazione del calendario: dice quanti
 * turni escono, così basta lui al posto di un avviso a parte.
 */
export function publishCta(count: number): string {
  return `Pubblica ${count} ${count === 1 ? "turno" : "turni"}`;
}

export const PUBLISH_CTA_HINT = "Il team non li vede finché non li pubblichi.";

/**
 * Le bozze che il pulsante non pubblica, accanto al periodo: quelle di altre
 * settimane o mesi e quelle ormai finite. Null se non ce ne sono.
 */
export function otherDraftsText(input: {
  upcoming: number;
  expired: number;
}): string | null {
  const { upcoming, expired } = input;
  const parts: string[] = [];
  if (upcoming > 0) {
    parts.push(
      upcoming === 1
        ? "1 bozza in un altro periodo"
        : `${upcoming} bozze in altri periodi`
    );
  }
  if (expired > 0) {
    parts.push(`${expired} mai ${expired === 1 ? "pubblicato" : "pubblicati"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Le bozze che «Pubblica» non tocca, ridotte alla riga accanto al periodo: il
 * testo e il giorno a cui porta (la prima ancora da pubblicare, altrimenti la
 * prima ormai finita). Solo le sedi in `venueIds`, cioè quelle dove chi guarda
 * può pubblicare. Condiviso da app e dashboard.
 */
export function otherDrafts(
  drafts: (ShiftTimes & { venue_id: string })[],
  opts: { from: string; to: string; venueIds: string[]; now?: Date }
): { text: string | null; target: string | null } {
  const now = opts.now ?? new Date();
  let upcoming = 0;
  let expired = 0;
  let target: string | null = null;
  let expiredTarget: string | null = null;
  for (const d of drafts) {
    if (!opts.venueIds.includes(d.venue_id)) continue;
    if (d.date >= opts.from && d.date <= opts.to) continue;
    if (isShiftOver(d, now)) {
      expired += 1;
      if (expiredTarget === null || d.date < expiredTarget) expiredTarget = d.date;
    } else {
      upcoming += 1;
      if (target === null || d.date < target) target = d.date;
    }
  }
  const text = otherDraftsText({ upcoming, expired });
  return { text, target: text ? (target ?? expiredTarget) : null };
}

/**
 * Perché la pubblicazione non avvisa nessuno. Chi pubblica non riceve mai la
 * propria notifica: il titolare che si mette in turno da sé non è «un turno
 * senza persone», e prima la finestra diceva proprio quello.
 */
export function nobodyToNotifyText(
  p: Pick<PublishPreview, "assignees" | "self">
): string {
  if (p.assignees === undefined) return "Nessuno da avvisare.";
  if (p.assignees === 0) {
    return "Nessuno da avvisare: questi turni non hanno ancora persone.";
  }
  if (p.self && p.assignees === 1) {
    return "Nessuno da avvisare: nei turni ci sei solo tu, e chi pubblica non riceve la notifica.";
  }
  return p.self
    ? "Nessuno da avvisare: a parte te, chi è nei turni non ha ancora l'app collegata."
    : "Nessuno da avvisare: chi è nei turni non ha ancora l'app collegata.";
}

const monthName = new Intl.DateTimeFormat("it-IT", { month: "long" });

/**
 * Le bozze di tutte le sedi ridotte a quel che serve all'avviso: quante sono
 * ancora da pubblicare, quante ormai finite, in che mesi, e la prima da
 * pubblicare (dove porta il tocco sull'avviso).
 */
export function summarizeDrafts(
  drafts: ShiftTimes[],
  now: Date = new Date()
): {
  upcoming: number;
  expired: number;
  months: string[];
  firstDate: string | null;
} {
  let upcoming = 0;
  let expired = 0;
  let firstDate: string | null = null;
  const months: string[] = [];
  for (const d of drafts) {
    if (isShiftOver(d, now)) {
      expired += 1;
      continue;
    }
    upcoming += 1;
    if (firstDate === null || d.date < firstDate) firstDate = d.date;
    const m = monthName.format(new Date(`${d.date}T00:00:00`));
    if (!months.includes(m)) months.push(m);
  }
  return { upcoming, expired, months, firstDate };
}

/** «Pubblicati 12 turni» / «Pubblicato 1 turno». */
export function publishedToast(count: number): string {
  return count === 1 ? "Pubblicato 1 turno" : `Pubblicati ${count} turni`;
}

/** «Salva in bozza»: una frase sola, anche per più giorni. */
export function savedDraftToast(count: number): string {
  return count === 1
    ? "Turno salvato in bozza"
    : `${count} turni salvati in bozza`;
}

/** «Salva e pubblica»: i turni esistono, ma la pubblicazione non è andata. */
export const SAVED_AS_DRAFT_NOT_PUBLISHED =
  "Turni salvati in bozza, ma non pubblicati. Pubblicali dall'agenda.";

export const PUBLISH_PREVIEW_ERROR = "Impossibile preparare la pubblicazione.";
export const PUBLISH_EMPTY =
  "Non ci sono bozze da pubblicare in questo periodo.";
export const PUBLISH_ERROR = "Impossibile pubblicare i turni.";

/** Il titolo della finestra: dice il periodo che esce, non «i turni» in generale. */
export function publishTitle(period: "week" | "month"): string {
  return period === "week" ? "Pubblica la settimana" : "Pubblica il mese";
}

/** Accanto al numero grande: «5 turni in bozza». */
export function draftsCountLabel(count: number): string {
  return count === 1 ? "turno in bozza" : "turni in bozza";
}

/**
 * La scelta degli avvisi è una spunta, accesa di default, e non un secondo
 * pulsante: con due pulsanti gialli e grigi affiancati non si capiva quale
 * fosse quello normale.
 */
export function notifyLabel(people: number): string {
  return `Avvisa ${people} ${people === 1 ? "persona" : "persone"}`;
}
export const NOTIFY_HINT =
  "Ognuno riceve una sola notifica con tutti i suoi turni.";
export const SILENT_HINT =
  "Vedranno i turni nell'agenda, senza notifica.";

/** Le bozze che questa pubblicazione lascia dove sono. Null se non ce ne sono. */
export function outsideNote(outside: number): string | null {
  if (outside <= 0) return null;
  return outside === 1
    ? "C'è un'altra bozza fuori da questo periodo: resta in bozza."
    : `Altre ${outside} bozze fuori da questo periodo restano in bozza.`;
}

export const DRAFT_DELETE_LABEL = "Elimina";
export const DRAFT_DELETE_TITLE = "Eliminare la bozza?";
export const DRAFT_DELETE_MESSAGE =
  "La bozza sparisce per sempre. Nessuno è stato avvisato, nessuno lo sarà.";
export const DRAFT_DELETED_TOAST = "Bozza eliminata";
export const DRAFT_EXPIRED_NOTE =
  "Questo turno è finito senza essere mai pubblicato: lo si elimina o lo si registra come fatto (serve il permesso «Ore»).";
export const RECORD_DRAFT_TITLE = "Registrare il turno come fatto?";
export const RECORD_DRAFT_MESSAGE =
  "Il turno diventa un turno svolto: le persone risultano presenti e le ore contano subito. Non parte nessuna notifica.";
export const RECORD_DRAFT_DONE_TOAST = "Turno registrato";

/** «Conferma tutti» del dipendente: la domanda e l'esito. */
export function confirmAllQuestion(count: number): string {
  return count === 1 ? "Confermi 1 turno?" : `Confermi ${count} turni?`;
}

export function confirmedToast(count: number): string {
  return count === 1 ? "Confermato 1 turno" : `Confermati ${count} turni`;
}
