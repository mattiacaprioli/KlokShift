/**
 * Spazio documenti dell'azienda (`get_member_document_quota`): quanto usa e il
 * suo limite (2 GiB, o quello concesso). Regole in docs/MONETIZATION.md §7:
 * avvisi all'80% e al 90%, a quota piena si bloccano solo i nuovi caricamenti.
 * Nessun prezzo qui: il testo vale anche nell'app nativa. Non importa Expo.
 */
export type DocumentQuota = { used_bytes: number; limit_bytes: number };

export function parseDocumentQuota(value: unknown): DocumentQuota | null {
  const raw = value as Record<string, unknown> | null;
  const used = Number(raw?.used_bytes);
  const limit = Number(raw?.limit_bytes);
  return Number.isFinite(used) && used >= 0 && Number.isFinite(limit) && limit > 0
    ? { used_bytes: used, limit_bytes: limit } : null;
}

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(gib)} GB`;
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(bytes / 1024 ** 2)} MB`;
}

export type QuotaNotice = { level: "warning" | "critical" | "full"; text: string };

/** Avviso da mostrare sopra i documenti; `null` sotto l'80%. */
export function documentQuotaNotice(q: DocumentQuota | null | undefined): QuotaNotice | null {
  if (!q) return null;
  const ratio = q.used_bytes / q.limit_bytes;
  const of = `${formatBytes(q.used_bytes)} di ${formatBytes(q.limit_bytes)}`;
  if (ratio >= 1) {
    return { level: "full", text: `Spazio documenti dell'azienda pieno (${of}): non si possono caricare nuovi file. I documenti già caricati restano consultabili. Elimina quelli che non servono più o scrivi a info@klokshift.com per avere più spazio.` };
  }
  if (ratio >= 0.9) return { level: "critical", text: `Spazio documenti dell'azienda quasi pieno: ${of}.` };
  if (ratio >= 0.8) return { level: "warning", text: `Spazio documenti dell'azienda: ${of}.` };
  return null;
}
