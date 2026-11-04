// I codici per il consulente: il codice dell'azienda, un codice per causale e la
// matricola di ogni persona, come li dà `get_export_codes`.
//
// Modulo **puro** (nessun import di Supabase, Expo o React): lo usano i
// costruttori degli export, condivisi con la dashboard web.

import type { AbsenceSummaryRow } from "@/features/absences/summary";
import type { MonthlyReportRow } from "./monthlyReport";

export type ExportCodeKey = "company" | "work" | "ferie" | "permesso" | "malattia";

export type ExportCodes = {
  codes: Partial<Record<ExportCodeKey, string>>;
  /** `person_id` (= member id) → matricola. Solo chi ce l'ha. */
  matricole: Map<string, string>;
};

export const EXPORT_CODE_KEYS: readonly ExportCodeKey[] = [
  "company",
  "work",
  "ferie",
  "permesso",
  "malattia",
];

export const EXPORT_CODE_LABELS: Record<ExportCodeKey, string> = {
  company: "Codice azienda",
  work: "Lavoro",
  ferie: "Ferie",
  permesso: "Permesso",
  malattia: "Malattia",
};

const isKey = (k: string): k is ExportCodeKey =>
  (EXPORT_CODE_KEYS as readonly string[]).includes(k);

/** Dalla risposta della RPC (un `jsonb`) ai codici; quel che manca è vuoto. */
export function toExportCodes(raw: unknown): ExportCodes {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const codes: Partial<Record<ExportCodeKey, string>> = {};
  const rawCodes = obj.codes && typeof obj.codes === "object" ? obj.codes : {};
  for (const [k, v] of Object.entries(rawCodes as Record<string, unknown>)) {
    if (isKey(k) && typeof v === "string" && v !== "") codes[k] = v;
  }
  const matricole = new Map<string, string>();
  if (Array.isArray(obj.matricole)) {
    for (const m of obj.matricole as { member_id?: unknown; matricola?: unknown }[]) {
      if (typeof m?.member_id === "string" && typeof m.matricola === "string") {
        matricole.set(m.member_id, m.matricola);
      }
    }
  }
  return { codes, matricole };
}

/**
 * L'avviso sopra gli export della pagina Ore: chi è senza matricola e quali
 * causali usate nel periodo sono senza codice. Non blocca niente, come quello dei
 * certificati. Tace se l'azienda non usa né matricole né codici: a chi non li usa
 * non serve un avviso a ogni export. `null` = niente da dire.
 */
export function exportCodesWarning(input: {
  personIds: readonly string[];
  usedKeys: readonly ExportCodeKey[];
  codes: ExportCodes;
}): string | null {
  const { personIds, usedKeys, codes } = input;
  const anyCode = Object.keys(codes.codes).length > 0;
  if (!anyCode && codes.matricole.size === 0) return null;

  const parts: string[] = [];
  const missing = new Set(personIds.filter((id) => !codes.matricole.has(id))).size;
  if (missing > 0) {
    parts.push(
      `${missing === 1 ? "1 persona" : `${missing} persone`} senza matricola: nel file la colonna resta vuota.`
    );
  }
  if (anyCode) {
    const keys: ExportCodeKey[] = ["company", ...usedKeys.filter((k) => k !== "company")];
    const uncoded = [...new Set(keys)].filter((k) => !codes.codes[k]);
    if (uncoded.length > 0) {
      parts.push(`Senza codice: ${uncoded.map((k) => EXPORT_CODE_LABELS[k]).join(", ")}.`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Le causali che nel periodo compaiono davvero nei file: il lavoro se c'è un
 * turno contato, ogni assenza con giorni o ore. Solo di queste l'avviso dice che
 * manca il codice.
 */
export function usedExportKeys(
  report: readonly Pick<MonthlyReportRow, "shifts_count" | "worked_hours">[],
  absences: readonly Pick<AbsenceSummaryRow, "ferie_days" | "permesso_days" | "permesso_hours" | "malattia_days">[]
): ExportCodeKey[] {
  const keys: ExportCodeKey[] = [];
  if (report.some((r) => r.shifts_count > 0 || r.worked_hours > 0)) keys.push("work");
  if (absences.some((a) => a.ferie_days > 0)) keys.push("ferie");
  if (absences.some((a) => a.permesso_days > 0 || a.permesso_hours > 0)) keys.push("permesso");
  if (absences.some((a) => a.malattia_days > 0)) keys.push("malattia");
  return keys;
}
