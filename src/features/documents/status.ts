import { addDaysToDate, formatDate, todayString } from "@/lib/format";

/**
 * Lo stato di un documento rispetto alla sua scadenza. Logica pura e condivisa
 * fra app e dashboard: è la stessa ragione per cui lo sono la copertura e le
 * ore — i due schermi devono dire la stessa cosa dello stesso documento.
 *
 * ⚠️ Il confronto è fra stringhe `YYYY-MM-DD`, mai fra `Date`. `new Date(x) <
 * new Date()` confronta un mezzanotte **UTC** con l'istante locale: a Roma un
 * documento che scade oggi risulterebbe già scaduto per due ore ogni notte.
 */

/** Da quanti giorni prima un documento è «in scadenza». */
export const EXPIRING_SOON_DAYS = 30;

export type DocumentStatus = "none" | "valid" | "expiring" | "expired";

export function documentStatus(
  expiresAt: string | null,
  today: string = todayString()
): DocumentStatus {
  if (!expiresAt) return "none";
  if (expiresAt < today) return "expired";
  if (expiresAt <= addDaysToDate(today, EXPIRING_SOON_DAYS)) return "expiring";
  return "valid";
}

/** L'etichetta da mostrare accanto al nome del documento. */
export function documentStatusLabel(
  expiresAt: string | null,
  today: string = todayString()
): string {
  const status = documentStatus(expiresAt, today);
  if (status === "none" || !expiresAt) return "Senza scadenza";
  if (status === "expired") return `Scaduto il ${formatDate(expiresAt)}`;
  return `Scade il ${formatDate(expiresAt)}`;
}
