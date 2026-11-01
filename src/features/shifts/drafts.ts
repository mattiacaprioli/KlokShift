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
export const PUBLISH = "Pubblica";
export const PUBLISH_NOTIFY = "Pubblica e avvisa";
export const PUBLISH_SILENT = "Pubblica senza avvisi";
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

export const NOBODY_TO_NOTIFY =
  "Nessuno da avvisare: i turni sono senza persone o senza account.";

/** La scelta «avvisa / senza avvisi» ha senso solo se c'è qualcuno da avvisare. */
export function shouldOfferNotifyChoice(
  p: Pick<PublishPreview, "people">
): boolean {
  return p.people > 0;
}

/** Cosa succede pubblicando: una riga per cosa, la terza solo se serve. */
export function publishPreviewLines(p: PublishPreview): string[] {
  const lines = [
    `${p.shifts} ${p.shifts === 1 ? "turno" : "turni"}`,
    p.people === 0
      ? NOBODY_TO_NOTIFY
      : `Avvisiamo ${p.people} ${p.people === 1 ? "persona" : "persone"}`,
  ];
  if (p.outside > 0) {
    lines.push(
      p.outside === 1
        ? "C'è un'altra bozza fuori da questo periodo"
        : `Ci sono altre ${p.outside} bozze fuori da questo periodo`
    );
  }
  return lines;
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
export const PUBLISH_TITLE = "Pubblica i turni";

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
