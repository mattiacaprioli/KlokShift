import type { Message } from "./api";

/**
 * Modifica ed elimina messaggio: quando mostrare le voci e cosa scrivere al
 * posto di un messaggio eliminato.
 *
 * ⚠️ I limiti sono gemelli **manuali** di `edit_message` / `delete_message`
 * (`20261118000100_chat_edit_delete.sql`): l'ultima parola è del database, qui
 * servono solo a non offrire una voce che verrebbe rifiutata. Cambiano insieme.
 */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_WINDOW_MS = 48 * 3_600_000;

export const DELETED_TEXT = "Messaggio eliminato";

type Actionable = Pick<
  Message,
  "sender_id" | "kind" | "deleted_at" | "created_at"
>;

function ownLiveText(m: Actionable, userId: string): boolean {
  return m.sender_id === userId && m.kind === "text" && m.deleted_at == null;
}

function within(m: Actionable, now: Date, windowMs: number): boolean {
  return now.getTime() - Date.parse(m.created_at) <= windowMs;
}

export function canEdit(m: Actionable, userId: string, now: Date): boolean {
  return ownLiveText(m, userId) && within(m, now, EDIT_WINDOW_MS);
}

export function canDelete(m: Actionable, userId: string, now: Date): boolean {
  return ownLiveText(m, userId) && within(m, now, DELETE_WINDOW_MS);
}

/** Il testo da mostrare in anteprima (lista chat) o nella bolla. */
export function previewText(m: Pick<Message, "content" | "deleted_at">): string {
  return m.deleted_at != null ? DELETED_TEXT : m.content;
}

/**
 * Un UPDATE su un messaggio che cambia l'anteprima della lista chat: una
 * modifica o un'eliminazione, non una semplice lettura (`read_at`). Così la
 * lista di chi riceve non continua a mostrare il testo vecchio.
 */
export function changesPreview(
  m: Pick<Message, "edited_at" | "deleted_at">
): boolean {
  return m.edited_at != null || m.deleted_at != null;
}
