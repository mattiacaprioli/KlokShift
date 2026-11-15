import { formatHours } from "@/lib/format";
import {
  buildAbsencesTable,
  buildDailyTable,
  buildHoursTable,
  type CsvTable,
} from "@/lib/exportBuilders";
import { formatSummaryDays, type AbsenceSummaryRow } from "@/features/absences/summary";
import { exportCodesWarning, usedExportKeys, type ExportCodes } from "./exportCodes";
import type { HourToFix } from "./api";
import type { HoursDailyRow } from "./hoursDaily";
import type { PersonHours } from "./hoursSummary";
import { hoursToFixSummary } from "./hoursToFix";
import { monthlyReportRows } from "./monthlyReport";
import type { SurchargeRow } from "./surcharges";

/*
 * Il pannello «Esporta per il consulente» della pagina Ore, in app e sulla
 * dashboard (spec 2026-11-15-anteprima-export-design.md): si sceglie il file, si
 * vedono i totali, cosa resta fuori o va controllato e le prime righe, poi si
 * scarica. Come Planday («Prepare report») e Deputy (riepilogo prima dell'invio).
 *
 * Le righe in anteprima sono le prime della **stessa** tabella da cui esce il
 * file (`build…Table` in `exportBuilders.ts`): non possono divergere. Gli
 * avvisi riusano i testi di sempre e non bloccano mai lo scarico.
 *
 * Modulo puro: lo usa anche la dashboard web.
 */

export type ExportFormat = "daily" | "monthly" | "absences" | "pdf";

export const EXPORT_FORMATS: readonly { key: ExportFormat; label: string }[] = [
  { key: "daily", label: "CSV giornaliero" },
  { key: "monthly", label: "CSV mensile" },
  { key: "absences", label: "CSV assenze" },
  { key: "pdf", label: "PDF da stampare" },
];

export const EXPORT_BUTTON_LABEL = "Esporta per il consulente";
export const EXPORT_ISSUES_TITLE = "Resta fuori o va controllato";

/** Dove si sistema una voce: la sezione «Ore da sistemare», i codici, le assenze, il team. */
export type ExportIssueTarget = "to_fix" | "codes" | "absences" | "team";
export type ExportIssue = { text: string; target: ExportIssueTarget };

/** Il testo del collegamento di ogni voce: lo stesso in app e dashboard. */
export const EXPORT_ISSUE_LINKS: Record<ExportIssueTarget, string> = {
  to_fix: "Ore da sistemare",
  codes: "Codici per il consulente",
  absences: "Assenze",
  team: "Team",
};

/**
 * Quali voci portano un collegamento: solo verso una pagina che chi esporta può
 * usare. Le assenze vogliono «Team» (come la pagina Assenze), le ore da
 * contratto le scrive solo il titolare (`contractSectionMode`).
 */
export function issueLinks(can: {
  canHours: boolean;
  canStaff: boolean;
  isOwner: boolean;
}): Record<ExportIssueTarget, boolean> {
  return { to_fix: true, codes: can.canHours, absences: can.canStaff, team: can.isOwner };
}

export type ExportPreview = {
  totals: { label: string; value: string }[];
  issues: ExportIssue[];
  /** `hiddenColumns`: colonne vuote in tutto il file, tolte dall'anteprima (il file le ha). */
  table: { header: string[]; rows: string[][]; more: number; hiddenColumns: number } | null;
  available: boolean;
  unavailableReason: string | null;
};

export const PREVIEW_ROWS = 5;

/** «3 colonne vuote non mostrate»; vuoto se non ne manca nessuna. */
export function hiddenColumnsLabel(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "1 colonna vuota non mostrata" : `${n} colonne vuote non mostrate`;
}

/**
 * Le colonne da mostrare: quelle con almeno un valore **in tutto il file**.
 * Senza codici il giornaliero comincia con tre colonne vuote che spingerebbero
 * causale e ore fuori dal riquadro; il file resta com'è.
 */
function filledColumns(table: CsvTable): number[] {
  const all = table.header.map((_, i) => i);
  if (table.rows.length === 0) return all;
  return all.filter((i) => table.rows.some((r) => (r[i] ?? "") !== ""));
}

/** «e altre 183 righe nel file»; vuoto se il file sta tutto nell'anteprima. */
export function moreRowsLabel(more: number): string {
  if (more <= 0) return "";
  return more === 1 ? "e un'altra riga nel file" : `e altre ${more} righe nel file`;
}

const sum = <T,>(rows: readonly T[], pick: (r: T) => number) =>
  rows.reduce((s, r) => s + pick(r), 0);

/** Le ore da sistemare delle sole persone scelte in pagina (`null` = tutte). */
export function toFixInSelection<T extends Pick<HourToFix, "member_id">>(
  items: readonly T[],
  selection: readonly string[] | null
): T[] {
  return selection ? items.filter((item) => selection.includes(item.member_id)) : [...items];
}

/**
 * Perché alcuni file non si possono scegliere, in una riga visibile sotto i
 * formati: «CSV giornaliero, CSV mensile e PDF da stampare: nessuna ora in
 * questo periodo.». `null` se si possono scegliere tutti.
 */
export function unavailableNote(previews: Record<ExportFormat, ExportPreview>): string | null {
  const byReason = new Map<string, string[]>();
  for (const f of EXPORT_FORMATS) {
    const reason = previews[f.key].unavailableReason;
    if (!reason) continue;
    byReason.set(reason, [...(byReason.get(reason) ?? []), f.label]);
  }
  if (byReason.size === 0) return null;
  return [...byReason]
    .map(([reason, labels]) => {
      const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}` : labels[0];
      return `${list}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
    })
    .join(" ");
}

/**
 * Il formato dopo (`1`) o prima (`-1`) con le frecce, in giro e saltando quelli
 * non disponibili; se non ce n'è un altro resta quello di ora.
 */
export function nextFormat(
  current: ExportFormat,
  dir: 1 | -1,
  previews: Record<ExportFormat, ExportPreview>
): ExportFormat {
  const keys = EXPORT_FORMATS.map((f) => f.key);
  const start = keys.indexOf(current);
  for (let step = 1; step < keys.length; step++) {
    const key = keys[(start + dir * step + keys.length) % keys.length];
    if (previews[key].available) return key;
  }
  return current;
}

function previewTable(table: CsvTable): NonNullable<ExportPreview["table"]> {
  const cols = filledColumns(table);
  return {
    header: cols.map((i) => table.header[i]),
    rows: table.rows.slice(0, PREVIEW_ROWS).map((r) => cols.map((i) => r[i] ?? "")),
    more: Math.max(0, table.rows.length - PREVIEW_ROWS),
    hiddenColumns: table.header.length - cols.length,
  };
}

export function buildExportPreview(input: {
  format: ExportFormat;
  people: PersonHours[];
  absences: AbsenceSummaryRow[];
  /** Le righe del giorno, lette all'apertura del pannello; `null` finché non arrivano. */
  daily: HoursDailyRow[] | null;
  codes: ExportCodes;
  surcharges: SurchargeRow[];
  toFix: Pick<HourToFix, "hours">[];
  /** I testi delle funzioni d'avviso di sempre (`null` = niente da dire). */
  warnings: { certificates: string | null; contract: string | null };
  availability: { monthly: boolean; absences: boolean };
  /**
   * Se chi esporta può scrivere i codici: altrimenti (archivio, niente «Ore»)
   * l'avviso dei codici tace, come faceva sopra la tabella prima del pannello.
   */
  codesEditable: boolean;
}): ExportPreview {
  const { format, people, absences, daily, codes, surcharges, warnings } = input;
  // Giornaliero, mensile e PDF si scaricano solo con le ore lette all'apertura
  // (righe del giorno e maggiorazioni arrivano insieme): se il pannello si è
  // aperto mentre le ore arrivavano, niente file mezzo vuoto.
  const hoursLoaded = daily !== null;
  let unavailableReason: string | null = null;
  if (format === "absences") {
    if (!input.availability.absences) unavailableReason = "Nessuna assenza in questo periodo.";
  } else if (!input.availability.monthly) {
    unavailableReason = "Nessuna ora in questo periodo.";
  } else if (!hoursLoaded) {
    unavailableReason = "Le ore non erano ancora pronte: chiudi e riapri il pannello.";
  }
  const available = unavailableReason === null;

  // Il file del formato, se c'è: da qui vengono righe e conteggio.
  let table: CsvTable | null = null;
  if (available && format === "daily" && daily) table = buildDailyTable(daily, codes, surcharges);
  if (available && format === "monthly") table = buildHoursTable(people, absences, codes, surcharges);
  if (available && format === "absences") table = buildAbsencesTable(absences, codes);

  const totals: ExportPreview["totals"] = [];
  if (format === "daily") {
    if (available && daily) {
      totals.push(
        { label: "Ore lavorate", value: formatHours(sum(daily, (r) => (r.kind === "work" ? r.hours ?? 0 : 0))) },
        {
          label: "Ferie e permessi",
          value: formatHours(sum(daily, (r) => (r.kind === "ferie" || r.kind === "permesso" ? r.hours ?? 0 : 0))),
        },
        { label: "Malattia", value: formatHours(sum(daily, (r) => (r.kind === "malattia" ? r.hours ?? 0 : 0))) }
      );
    }
  } else if (format === "absences") {
    const permessoDays = sum(absences, (a) => a.permesso_days);
    const permessoHours = sum(absences, (a) => a.permesso_hours);
    const permessi = [
      permessoDays > 0 ? formatSummaryDays(permessoDays) : null,
      permessoHours > 0 ? formatHours(permessoHours) : null,
    ].filter(Boolean);
    totals.push(
      { label: "Ferie", value: formatSummaryDays(sum(absences, (a) => a.ferie_days)) },
      { label: "Permessi", value: permessi.length > 0 ? permessi.join(" e ") : "—" },
      { label: "Malattia", value: formatSummaryDays(sum(absences, (a) => a.malattia_days)) }
    );
  } else {
    const report = monthlyReportRows(people, absences);
    totals.push(
      { label: "Ore lavorate", value: formatHours(sum(report, (r) => r.worked_hours)) },
      { label: "Ferie e permessi", value: formatHours(sum(report, (r) => r.ferie_hours + r.permesso_hours)) },
      { label: "Malattia", value: formatHours(sum(report, (r) => r.malattia_hours)) }
    );
  }
  if (table) totals.push({ label: "Righe nel file", value: String(table.rows.length) });

  // Le voci, in quest'ordine e solo per i file in cui contano.
  const issues: ExportIssue[] = [];
  const csv = format !== "pdf";
  if (format !== "absences" && input.toFix.length > 0) {
    issues.push({
      text: `${hoursToFixSummary(input.toFix)}: nel file restano «Da verificare».`,
      target: "to_fix",
    });
  }
  // I codici del file scelto: il CSV assenze porta solo la matricola, nessun
  // codice di causale, quindi lì l'avviso parla solo di matricole.
  const codesText = !csv || !input.codesEditable
    ? null
    : format === "absences"
      ? exportCodesWarning({
          personIds: absences.map((a) => a.person_id),
          usedKeys: [],
          codes: { codes: {}, matricole: codes.matricole },
        })
      : exportCodesWarning({
          personIds: monthlyReportRows(people, absences).map((r) => r.person_id),
          usedKeys: usedExportKeys(monthlyReportRows(people, absences), absences, surcharges),
          codes,
        });
  if (codesText) issues.push({ text: codesText, target: "codes" });
  // La colonna dei certificati c'è solo nel CSV delle assenze e nel PDF.
  if ((format === "absences" || format === "pdf") && warnings.certificates) {
    issues.push({ text: warnings.certificates, target: "absences" });
  }
  // Lo straordinario c'è solo dove ci sono le maggiorazioni.
  if (format !== "absences" && warnings.contract) issues.push({ text: warnings.contract, target: "team" });

  return {
    totals,
    issues,
    table: table ? previewTable(table) : null,
    available,
    unavailableReason,
  };
}
