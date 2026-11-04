// Costruttori puri dei documenti di export (ore/presenze).
//
// Volutamente SENZA import Expo/React Native: questo modulo è condiviso con la
// dashboard web (`web/`), che riusa gli stessi identici output e sostituisce solo
// l'ultimo passo — Print/Sharing/FileSystem su mobile, Blob/window.print() su web.
// Il rendering nativo sta in `src/lib/export.ts`, che importa da qui.

import type {
  DailyKind,
  HoursDailyRow,
} from "@/features/assignments/hoursDaily";
import { HOUR_TO_FIX_KIND_LABEL } from "@/features/assignments/hoursToFix";
import type { HourToFixKind } from "@/features/assignments/api";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { ExportCodes } from "@/features/assignments/exportCodes";
import {
  surchargeColumnKey,
  surchargeColumns,
  surchargeLabel,
  surchargeTotals,
  type SurchargeRow,
} from "@/features/assignments/surcharges";
import { monthlyReportRows } from "@/features/assignments/monthlyReport";
import {
  ABSENCE_SUMMARY_NOTE,
  type AbsenceSummaryRow,
} from "@/features/absences/summary";
import { MONTH_NAMES } from "@/lib/format";

// Ore come numero italiano (virgola, senza suffisso): "12,25" · "12,5" · "5".
// Due decimali al massimo; `String` toglie gli zeri finali da solo (7.50 → "7.5").
function hoursNumber(h: number): string {
  const r = Math.round(h * 100) / 100;
  return String(r).replace(".", ",");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * La pausa nel PDF: quanta è già dentro le ore lavorate e quanta ne è rimasta
 * fuori. Due quantità diverse, mai sommate a niente.
 */
function breakCell(paidHours: number, unpaidHours: number): string {
  const parts = [
    paidHours > 0 ? `${hoursNumber(paidHours)} h retribuita (inclusa)` : null,
    unpaidHours > 0 ? `${hoursNumber(unpaidHours)} h non retribuita (esclusa)` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Le stesse anomalie per cui il CSV scrive «Da verificare», a parole. */
function reviewCell(conflictHours: number, untrackedHours: number, toReviewCount: number): string {
  const parts = [
    conflictHours > 0 ? `${hoursNumber(conflictHours)} h assenza` : null,
    untrackedHours > 0 ? `${hoursNumber(untrackedHours)} h senza timbratura` : null,
    toReviewCount > 0
      ? `${toReviewCount} ${toReviewCount === 1 ? "turno" : "turni"} da verificare`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Tabella HTML stampabile (scuro-su-bianco, accento gold). Solo ore/presenze.
 *
 * Una riga per **persona**, col totale del mese: è la cifra della busta paga, ed
 * è l'unica che serve. Fino al 14/09/2026 sotto ogni persona c'erano le righe
 * delle sue sedi; sono state tolte perché la domanda a cui rispondevano — «di
 * queste 40 ore, quante a Roma?» — non è quella che si porta al commercialista,
 * e raddoppiavano la lunghezza del documento per dirlo.
 */
export function buildHoursHtml(
  companyName: string,
  periodLabel: string,
  people: PersonHours[],
  totalHours: number,
  /** Ferie, permessi e malattia del periodo: una seconda tabella, se ce ne sono. */
  absences: AbsenceSummaryRow[] = [],
  /**
   * I nomi delle persone scelte; vuoto = tutto il team. Il documento lo
   * dice, perché chi lo riceve deve sapere che non è l'azienda intera.
   */
  selection: readonly string[] = [],
  /** Il cartellino giorno per giorno, dopo le tabelle: su pagina nuova. */
  timesheet?: { rows: HoursDailyRow[]; start: string; end: string },
  /** Le maggiorazioni del periodo: colonne «di cui» dopo le ore lavorate. */
  surcharges: readonly SurchargeRow[] = []
): string {
  const rows = monthlyReportRows(people, absences);
  const surCols = surchargeColumns(surcharges);
  const surAll = surchargeTotals(surcharges);
  const surCells = (totals: Map<string, number>) =>
    surCols.map((c) => `<td class="n">${hoursNumber(totals.get(surchargeColumnKey(c)) ?? 0)}</td>`).join("");
  const surHead = surCols
    .map((c) => `<th class="n">${escapeHtml(surchargeLabel(c.kind, c.percentage))}</th>`)
    .join("");
  const totalShifts = rows.reduce((s, p) => s + p.shifts_count, 0);
  const totalJustified = rows.reduce((s, p) => s + p.justified_hours, 0);
  const totalCoveredHours = rows.reduce((s, p) => s + p.covered_hours, 0);
  const totalPaidBreak = rows.reduce((s, p) => s + p.paid_break_hours, 0);
  const totalUnpaidBreak = rows.reduce((s, p) => s + p.unpaid_break_hours, 0);

  const body = rows
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.person_name)}</td>` +
        `<td>${escapeHtml(p.roles ?? "—")}</td>` +
        `<td class="n">${p.shifts_count}</td>` +
        `<td class="n">${hoursNumber(p.worked_hours)}</td>` +
        surCells(surchargeTotals(surcharges, p.person_id)) +
        `<td class="n">${breakCell(p.paid_break_hours, p.unpaid_break_hours)}</td>` +
        `<td class="n">${hoursNumber(p.justified_hours)}</td>` +
        `<td class="n">${hoursNumber(p.covered_hours)}</td>` +
        `<td class="n">${reviewCell(p.conflict_hours, p.untracked_hours, p.to_review_count)}</td></tr>`
    )
    .join("");

  const sub = `${escapeHtml(companyName)} · ${escapeHtml(periodLabel)}`;
  const scope =
    selection.length > 0
      ? `<div class="sub">Persone incluse: ${selection.map(escapeHtml).join(", ")}</div>`
      : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1206; margin: 32px; }
    @page { size: A4 landscape; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    .sub { color: #6a6358; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    h2 { font-size: 16px; margin: 32px 0 2px; }
    .note { color: #8c857a; font-size: 11px; margin-bottom: 12px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e7e2d8; }
    th { color: #8c857a; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    td.n, th.n { text-align: right; }
    tfoot td { font-weight: 700; border-top: 2px solid #eab54c; border-bottom: none; }
    .accent { height: 4px; width: 48px; background: #eab54c; border-radius: 2px; margin-bottom: 16px; }
    .foot { margin-top: 28px; color: #a49a8a; font-size: 11px; }
    ${timesheet ? TIMESHEET_CSS : ""}
  </style></head><body>
    <div class="accent"></div>
    <h1>Ore tracciate</h1>
    <div class="sub">${sub}</div>
    ${scope}
    <table>
      <thead><tr><th>Nome</th><th>Ruolo</th><th class="n">Turni</th><th class="n">Ore lavorate effettive</th>${surHead}<th class="n">Pausa</th><th class="n">Ore di assenza giustificata</th><th class="n">Totale ore coperte</th><th class="n">Da verificare</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Totale</td><td></td><td class="n">${totalShifts}</td><td class="n">${hoursNumber(totalHours)}</td>${surCells(surAll)}<td class="n">${breakCell(totalPaidBreak, totalUnpaidBreak)}</td><td class="n">${hoursNumber(totalJustified)}</td><td class="n">${hoursNumber(totalCoveredHours)}</td><td></td></tr></tfoot>
    </table>
    ${absences.length > 0 ? absencesHtmlSection(absences) : ""}
    ${timesheet ? buildTimesheetHtml(timesheet.rows, timesheet, surcharges) : ""}
    <div class="foot">Documento generato da KlokShift · Il totale indica ore coperte, non un importo o un trattamento retributivo. Le ore da verificare sono escluse. La pausa retribuita è già compresa nelle ore lavorate, quella non retribuita ne è esclusa. I codici evento del CSV vanno confermati con il consulente in base al contratto applicato.</div>
  </body></html>`;
}

/** Un numero di giorni o ore nel documento: vuoto se zero, per leggere a colpo d'occhio. */
function countCell(n: number): string {
  return n > 0 ? hoursNumber(n) : "—";
}

/**
 * La tabella delle assenze nel PDF, sotto quella delle ore. Una tabella a parte
 * e non colonne in più: le ore sono il lavorato, le assenze il non lavorato, e il
 * commercialista le legge in due momenti diversi.
 */
function absencesHtmlSection(rows: AbsenceSummaryRow[]): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.person_name)}</td>` +
        `<td class="n">${countCell(r.ferie_days)}</td>` +
        `<td class="n">${countCell(r.permesso_days)}</td>` +
        `<td class="n">${countCell(r.permesso_hours)}</td>` +
        `<td class="n">${countCell(r.malattia_days)}</td>` +
        `<td>${escapeHtml(r.inps_protocols ?? "—")}</td></tr>`
    )
    .join("");
  return `
    <h2>Assenze</h2>
    <div class="note">${escapeHtml(ABSENCE_SUMMARY_NOTE)}</div>
    <table>
      <thead><tr><th>Nome</th><th class="n">Ferie (gg)</th><th class="n">Permessi (gg)</th><th class="n">Permessi (h)</th><th class="n">Malattia (gg)</th><th>Riferimenti certificati medici</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Una cella di **testo** (nome, ruolo, riferimenti): se comincia come una
 * formula (`=`, `+`, `-`, `@`, tab, a capo) un foglio elettronico la
 * eseguirebbe all'apertura. L'apostrofo davanti la lascia testo letterale.
 * Le celle numeriche passano da `csvCell`: un numero non va reso testo, o il
 * foglio smette di sommarlo.
 */
function csvText(v: string): string {
  return csvCell(/^[=+\-@\t\r\n]/.test(v) ? `'${v}` : v);
}

/**
 * CSV separatore ';' e decimali con virgola (default Excel IT), con BOM UTF-8.
 *
 * **Una riga per persona, col totale.** Al commercialista serve quante ore ha fatto
 * Mattia, non in quale delle tre sedi le ha fatte: è una busta paga sola. Lo split
 * per sede serve al titolare per allocare i costi, e sta nella pagina Ore e nel PDF.
 *
 * Le colonne evento sono distinte: nessuna assenza entra nelle ore ordinarie.
 * Le due colonne di pausa accanto alle ore lavorate dicono quanta pausa è già
 * dentro (retribuita) e quanta ne è rimasta fuori (non retribuita).
 */
export function buildHoursCsv(
  people: PersonHours[],
  absences: AbsenceSummaryRow[] = [],
  codes?: ExportCodes,
  /** Le maggiorazioni del periodo: una colonna «di cui» per voce e percentuale. */
  surcharges: readonly SurchargeRow[] = []
): string {
  const surCols = surchargeColumns(surcharges);
  // Con i codici per il consulente: la matricola dopo il nome e il codice di
  // ogni causale fra parentesi nell'intestazione della sua colonna. Senza,
  // il file è quello di sempre.
  // Il codice lo scrive l'utente: la cella passa da `csvCell`, o un «;» dentro
  // sposterebbe tutte le colonne dopo.
  const coded = (label: string, code: string | undefined, rest = "") =>
    csvCell(`${label}${codes && code ? ` (${code})` : ""}${rest}`);
  const header = [
    "Nome",
    ...(codes ? ["Matricola"] : []),
    "Ruolo",
    "Turni",
    coded("Ore lavorate effettive", codes?.codes.work),
    "Di cui pausa retribuita",
    "Pausa non retribuita esclusa",
    ...surCols.map((c) => coded(surchargeLabel(c.kind, c.percentage), codes?.codes[c.kind])),
    coded("Ferie", codes?.codes.ferie, " - ore riconosciute"),
    coded("MAL/Malattia", codes?.codes.malattia, " - ore riconosciute"),
    coded("Permessi", codes?.codes.permesso, " - ore riconosciute"),
    "Ore di assenza giustificata",
    "Totale ore coperte",
    "Ore di assenza da verificare",
    "Ore senza timbratura escluse",
    "Stato",
  ].join(";");
  const lines = monthlyReportRows(people, absences).map((p) => {
    const sur = surchargeTotals(surcharges, p.person_id);
    return [
      csvText(p.person_name),
      ...(codes ? [csvText(codes.matricole.get(p.person_id) ?? "")] : []),
      csvText(p.roles ?? ""),
      String(p.shifts_count),
      hoursNumber(p.worked_hours),
      hoursNumber(p.paid_break_hours),
      hoursNumber(p.unpaid_break_hours),
      ...surCols.map((c) => hoursNumber(sur.get(surchargeColumnKey(c)) ?? 0)),
      hoursNumber(p.ferie_hours),
      hoursNumber(p.malattia_hours),
      hoursNumber(p.permesso_hours),
      hoursNumber(p.justified_hours),
      hoursNumber(p.covered_hours),
      hoursNumber(p.conflict_hours),
      hoursNumber(p.untracked_hours),
      p.conflict_hours > 0 || p.untracked_hours > 0 || p.to_review_count > 0 ? "Da verificare" : "",
    ].join(";");
  });
  return "﻿" + [header, ...lines].join("\r\n");
}

/**
 * CSV delle assenze del mese: **un file a parte**. Il CSV delle ore porta solo
 * le ore riconosciute (vedi `buildHoursCsv`); giorni e certificati stanno qui.
 *
 * Stesse convenzioni: ';', decimali con virgola, BOM. I giorni sono di
 * calendario, e l'intestazione lo dice, perché un CSV non ha una nota a piè di
 * pagina. Le celle vuote valgono zero: un foglio le somma senza lamentarsi.
 */
export function buildAbsencesCsv(rows: AbsenceSummaryRow[], codes?: ExportCodes): string {
  const header = [
    "Nome",
    ...(codes ? ["Matricola"] : []),
    "Ferie (giorni di calendario)",
    "Permessi (giorni)",
    "Permessi (ore)",
    "Malattia (giorni di calendario)",
    "Riferimenti certificati medici",
  ].join(";");
  const num = (n: number) => (n > 0 ? hoursNumber(n) : "0");
  const lines = rows.map((r) =>
    [
      csvText(r.person_name),
      ...(codes ? [csvText(codes.matricole.get(r.person_id) ?? "")] : []),
      num(r.ferie_days),
      num(r.permesso_days),
      num(r.permesso_hours),
      num(r.malattia_days),
      csvText(r.inps_protocols ?? ""),
    ].join(";")
  );
  return "\uFEFF" + [header, ...lines].join("\r\n");
}

const DAILY_KIND_LABEL: Record<DailyKind, string> = {
  work: "Lavoro",
  to_fix: "Da verificare",
  ferie: "Ferie",
  permesso: "Permesso",
  malattia: "Malattia",
};

// La nota della riga giornaliera: il motivo del «da verificare», il conflitto
// con un'assenza, o la fascia di un permesso a ore.
function dailyNote(r: HoursDailyRow): string {
  if (r.kind === "to_fix" && r.note) {
    return HOUR_TO_FIX_KIND_LABEL[r.note as HourToFixKind] ?? "";
  }
  if (r.note === "conflict") return "Da verificare";
  const hourly = r.note?.match(/^hourly:(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return hourly ? `Dalle ${hourly[1]} alle ${hourly[2]}` : "";
}

/**
 * CSV giornaliero per il consulente: una riga per persona, giorno e turno
 * (le ore lavorate e le assenze restano righe separate, mai sommate).
 * Stesse convenzioni del CSV mensile: ';', virgola decimale, BOM. L'ordine è
 * quello della RPC; le ore vuote restano vuote, non diventano zero.
 */
export function buildDailyCsv(
  rows: HoursDailyRow[],
  codes?: ExportCodes,
  /**
   * Le maggiorazioni: dopo ogni riga di lavoro, una riga «di cui» per voce con
   * lo stesso giorno, sede, turno e orari. Non entrano nelle ore «Lavoro».
   */
  surcharges: readonly SurchargeRow[] = []
): string {
  // Con i codici per il consulente, tre colonne in testa come nel CSV di
  // Fluida: codice azienda, matricola, codice causale. «Da verificare» non ha
  // codice: non è una voce di busta paga.
  const header = [
    ...(codes ? ["Codice azienda", "Matricola", "Codice causale"] : []),
    "Data", "Persona", "Sede", "Turno", "Causale", "Entrata", "Uscita",
    "Pausa (min)", "Pausa retribuita", "Ore", "Note",
  ].join(";");
  const lines = rows.map((r) =>
    [
      ...(codes
        ? [
            csvText(codes.codes.company ?? ""),
            csvText(codes.matricole.get(r.person_id) ?? ""),
            csvText((r.kind === "to_fix" ? undefined : codes.codes[r.kind]) ?? ""),
          ]
        : []),
      r.date.split("-").reverse().join("/"),
      csvText(r.person_name),
      csvText(r.venue_name ?? ""),
      csvText(r.title ?? ""),
      DAILY_KIND_LABEL[r.kind],
      r.clock_in ?? "",
      r.clock_out ?? "",
      r.break_minutes == null ? "" : String(r.break_minutes),
      r.break_paid == null ? "" : r.break_paid ? "Sì" : "No",
      r.hours == null ? "" : hoursNumber(r.hours),
      dailyNote(r),
    ].join(";")
  );
  if (surcharges.length === 0) return "\uFEFF" + [header, ...lines].join("\r\n");

  const surLine = (s: SurchargeRow) =>
    [
      ...(codes
        ? [
            csvText(codes.codes.company ?? ""),
            csvText(codes.matricole.get(s.person_id) ?? ""),
            csvText(codes.codes[s.kind] ?? ""),
          ]
        : []),
      s.date.split("-").reverse().join("/"),
      csvText(s.person_name),
      csvText(s.venue_name ?? ""),
      csvText(s.title ?? ""),
      csvText(surchargeLabel(s.kind, s.percentage)),
      "", "", "", "",
      hoursNumber(s.hours),
      "",
    ].join(";");
  const order = surchargeColumns(surcharges).map(surchargeColumnKey);
  const sorted = [...surcharges].sort(
    (a, b) =>
      order.indexOf(surchargeColumnKey(a)) - order.indexOf(surchargeColumnKey(b))
  );
  // Le «di cui» di una riga di lavoro: stessa persona, giorno, sede, turno e orari.
  const used = new Set<SurchargeRow>();
  const out: { line: string; person: string; date: string }[] = [];
  rows.forEach((r, i) => {
    out.push({ line: lines[i], person: r.person_id, date: r.date });
    if (r.kind !== "work") return;
    for (const s of sorted) {
      if (used.has(s)) continue;
      if (s.person_id === r.person_id && s.date === r.date && s.venue_name === r.venue_name &&
          s.title === r.title && s.clock_in === r.clock_in && s.clock_out === r.clock_out) {
        used.add(s);
        out.push({ line: surLine(s), person: s.person_id, date: s.date });
      }
    }
  });
  // Senza la sua riga di lavoro (non dovrebbe succedere): in coda al giorno
  // della persona, altrimenti in fondo.
  for (const s of sorted) {
    if (used.has(s)) continue;
    let at = -1;
    out.forEach((o, i) => {
      if (o.person === s.person_id && o.date === s.date) at = i;
    });
    const item = { line: surLine(s), person: s.person_id, date: s.date };
    if (at < 0) out.push(item);
    else out.splice(at + 1, 0, item);
  }
  return "\uFEFF" + [header, ...out.map((o) => o.line)].join("\r\n");
}

/** "ore-giornaliere-osteria-novembre-2026.csv": stessa regola di `hoursFileName`. */
export function dailyFileName(
  companyName: string,
  periodLabel: string,
  ext: string,
  selection: readonly string[] = []
): string {
  return exportFileName("ore-giornaliere", companyName, periodLabel, ext, selection);
}

/**
 * Nome file condiviso mobile/web: "ore-osteria-milano-settembre-2026.csv" per chi
 * ha una sede sola, "ore-giuseppe-buffa-settembre-2026.csv" per chi ne ha tre.
 *
 * ⚠️ La versione precedente motivava il nome della sede con «sono tre buste paga
 * diverse». È **falso**, ed è l'errore corretto da 20260913110100: un dipendente
 * assunto dalla stessa azienda che fa 20 ore a Roma e 20 a Milano ha UNA busta paga
 * da 40 ore. L'export è uno, per azienda.
 *
 * Il nome resta nel file per la ragione vera: nella cartella Download tre file
 * "ore-settembre-2026.csv" sono indistinguibili, e uno di essi è l'allegato che
 * parte verso il commercialista. *Quale* nome — la sede o il titolare — lo decide
 * `companyName()`, con la stessa regola di `chat_counterpart`: se al dipendente
 * in chat compare "Giuseppe Buffa", al commercialista non può comparire
 * "Trattoria Roma".
 */
export function hoursFileName(
  companyName: string,
  periodLabel: string,
  ext: string,
  selection: readonly string[] = []
): string {
  return exportFileName("ore", companyName, periodLabel, ext, selection);
}

/** "assenze-osteria-milano-settembre-2026.csv": stessa regola di `hoursFileName`. */
export function absencesFileName(
  companyName: string,
  periodLabel: string,
  ext: string,
  selection: readonly string[] = []
): string {
  return exportFileName("assenze", companyName, periodLabel, ext, selection);
}

/**
 * Con una persona sola il nome finisce nel file ("…-ottobre-2026-anna-rossi"),
 * con più persone "-selezione": un file parziale non deve sembrare quello
 * dell'azienda intera nella cartella Download.
 */
function exportFileName(
  prefix: string,
  companyName: string,
  periodLabel: string,
  ext: string,
  selection: readonly string[]
): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      // Via gli accenti: un nome file con "è" o "à" viaggia male tra sistemi.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const scope =
    selection.length === 1
      ? `-${slug(selection[0])}`
      : selection.length > 1
        ? "-selezione"
        : "";
  return `${prefix}-${slug(companyName)}-${slug(periodLabel)}${scope}.${ext}`;
}

// ---------------------------------------------------------------------------
// Cartellino: una griglia persona × giorno per ogni mese di calendario.
// ---------------------------------------------------------------------------

const TIMESHEET_CSS = `
    .ts table { font-size: 10px; table-layout: fixed; }
    .ts th, .ts td { padding: 4px 2px; text-align: center; border: 1px solid #e7e2d8; }
    .ts th.who, .ts td.who { text-align: left; width: 150px; padding-left: 6px; }
    .ts td.who small { display: block; color: #8c857a; font-size: 9px; }
    .ts td small { color: #6a6358; font-size: 8px; }
    .ts .we { background: #f1eee7; }
    .ts td.t { font-weight: 700; background: #faf7ef; }
    .ts .legend { margin-top: 8px; color: #8c857a; font-size: 10px; }`;

const WEEKDAY_INITIAL = ["D", "L", "M", "M", "G", "V", "S"];

// Tutte le date in UTC: il fuso della macchina (o della CI) non deve spostare un
// sabato in venerdì.
function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Lo stesso mese, da `from` (incluso) a `to` (escluso), senza uscire dal mese di `from`. */
function monthSlices(start: string, end: string): { from: string; to: string; label: string }[] {
  const out: { from: string; to: string; label: string }[] = [];
  let cur = utcDate(start);
  const last = utcDate(end);
  while (cur < last) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const to = next < last ? next : last;
    out.push({
      from: isoOf(cur),
      to: isoOf(to),
      label: `${MONTH_NAMES[cur.getUTCMonth()]} ${cur.getUTCFullYear()}`,
    });
    cur = next;
  }
  return out;
}

const ABSENCE_LETTER: Partial<Record<DailyKind, string>> = {
  ferie: "F",
  permesso: "P",
  malattia: "M",
};

/**
 * Cosa scrivere nella casella di un giorno. Parti, in ordine: ore di lavoro;
 * per ogni tipo di assenza presente la lettera con le sue ore (se > 0; un'assenza
 * in conflitto non ha lettera, porta solo il «?»); «?» se c'è da verificare.
 * La prima parte sta in grande, le altre sotto in `<small>`. Le ore visibili
 * tornano coi totali di riga (il «?» non entra mai nelle somme).
 */
function timesheetCell(day: HoursDailyRow[]): string {
  const sum = (rows: HoursDailyRow[]) => rows.reduce((s, r) => s + (r.hours ?? 0), 0);
  const parts: string[] = [];
  const work = day.filter((r) => r.kind === "work");
  if (work.length > 0) parts.push(hoursNumber(sum(work)));
  let absenceOnly: string | null = null;
  for (const kind of ["ferie", "permesso", "malattia"] as const) {
    const list = day.filter((r) => r.kind === kind && r.note !== "conflict");
    if (list.length === 0) continue;
    const h = sum(list);
    if (h > 0) parts.push(`${ABSENCE_LETTER[kind]} ${hoursNumber(h)}`);
    else parts.push(ABSENCE_LETTER[kind] as string);
    absenceOnly = ABSENCE_LETTER[kind] as string;
  }
  if (day.some((r) => r.kind === "to_fix" || r.note === "conflict")) parts.push("?");
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    // Un'assenza sola con ore: lettera in grande, ore sotto.
    const m = absenceOnly && parts[0].startsWith(`${absenceOnly} `) ? parts[0].slice(2) : null;
    return m ? `${absenceOnly}<br><small>${m}</small>` : parts[0];
  }
  return `${parts[0]}<br><small>${parts.slice(1).join(" ")}</small>`;
}

function timesheetTable(
  rows: HoursDailyRow[],
  slice: { from: string; to: string; label: string },
  surcharges: readonly SurchargeRow[] = []
): string {
  const days: string[] = [];
  for (let d = utcDate(slice.from); isoOf(d) < slice.to; d = new Date(d.getTime() + 86400000)) {
    days.push(isoOf(d));
  }
  const inMonth = rows.filter((r) => r.date >= slice.from && r.date < slice.to);
  const people = new Map<string, HoursDailyRow[]>();
  for (const r of inMonth) {
    const list = people.get(r.person_id);
    if (list) list.push(r);
    else people.set(r.person_id, [r]);
  }
  const ordered = [...people.values()].sort((a, b) =>
    a[0].person_name.localeCompare(b[0].person_name, "it")
  );

  const isWeekend = (iso: string) => {
    const wd = utcDate(iso).getUTCDay();
    return wd === 0 || wd === 6;
  };
  const head =
    `<tr><th class="who">Persona</th>` +
    days
      .map((iso) => {
        const cls = isWeekend(iso) ? ' class="we"' : "";
        return `<th${cls}>${WEEKDAY_INITIAL[utcDate(iso).getUTCDay()]}<br>${Number(iso.slice(8))}</th>`;
      })
      .join("") +
    `<th>Lavoro</th><th>Ferie</th><th>Permessi</th><th>Malattia</th><th>gg senza ore</th></tr>`;

  const body = ordered
    .map((list) => {
      const venues = new Set(
        list.filter((r) => r.kind === "work" && r.venue_name).map((r) => r.venue_name as string)
      );
      const venueLine =
        venues.size === 1
          ? `<small>${escapeHtml([...venues][0])}</small>`
          : venues.size > 1
            ? `<small>${venues.size} sedi</small>`
            : "";
      const cells = days
        .map((iso) => {
          const cls = isWeekend(iso) ? "d we" : "d";
          return `<td class="${cls}">${timesheetCell(list.filter((r) => r.date === iso))}</td>`;
        })
        .join("");

      // I totali non toccano mai le righe da verificare né le assenze in conflitto.
      const ok = list.filter((r) => r.kind !== "to_fix" && r.note !== "conflict");
      const sum = (kind: DailyKind) =>
        ok.filter((r) => r.kind === kind).reduce((s, r) => s + (r.hours ?? 0), 0);
      const noHours = (kind: DailyKind) =>
        new Set(ok.filter((r) => r.kind === kind && !(r.hours != null && r.hours > 0)).map((r) => r.date)).size;
      const sick = sum("malattia");
      const sickDays = noHours("malattia");
      // Ore e giorni senza ore possono convivere: si dicono entrambi.
      const sickCell =
        sick > 0 && sickDays > 0
          ? `${hoursNumber(sick)} + ${sickDays} gg`
          : sick > 0
            ? hoursNumber(sick)
            : sickDays > 0
              ? `${sickDays} gg`
              : "—";
      const unpaid = noHours("ferie") + noHours("permesso");
      const t = (v: string) => `<td class="t">${v}</td>`;
      // Sotto la persona, una riga per maggiorazione: le ore «di cui» del giorno.
      const mine = surcharges.filter(
        (s) => s.person_id === list[0].person_id && s.date >= slice.from && s.date < slice.to
      );
      const subRows = surchargeColumns(mine)
        .map((c) => {
          const key = surchargeColumnKey(c);
          const of = mine.filter((s) => surchargeColumnKey(s) === key);
          const dayCells = days
            .map((iso) => {
              const h = of.filter((s) => s.date === iso).reduce((a, s) => a + s.hours, 0);
              return `<td class="${isWeekend(iso) ? "d we" : "d"}">${h > 0 ? hoursNumber(h) : ""}</td>`;
            })
            .join("");
          const total = of.reduce((a, s) => a + s.hours, 0);
          return (
            `<tr class="sub"><td class="who"><small>${escapeHtml(surchargeLabel(c.kind, c.percentage))}</small></td>` +
            `${dayCells}${t(countCell(total))}${t("")}${t("")}${t("")}${t("")}</tr>`
          );
        })
        .join("");
      return (
        `<tr><td class="who">${escapeHtml(list[0].person_name)}${venueLine}</td>${cells}` +
        t(countCell(sum("work"))) +
        t(countCell(sum("ferie"))) +
        t(countCell(sum("permesso"))) +
        t(sickCell) +
        t(unpaid > 0 ? `${unpaid} gg` : "—") +
        `</tr>` +
        subRows
      );
    })
    .join("");

  return `<div class="ts" style="page-break-before: always"><h2>Presenze · ${slice.label}</h2>
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="legend">Numeri = ore lavorate · F ferie · P permesso · M malattia · ? da verificare (non conteggiato). Sabato e domenica in grigio.</div></div>`;
}

/**
 * Il cartellino: una griglia persona × giorno per ogni mese di calendario dentro
 * `[start, end)`, ciascuna su pagina nuova. Solo ore e causali, mai importi.
 */
export function buildTimesheetHtml(
  rows: HoursDailyRow[],
  bounds: { start: string; end: string },
  /** Le maggiorazioni: una riga «di cui» per voce sotto ogni persona. */
  surcharges: readonly SurchargeRow[] = []
): string {
  return monthSlices(bounds.start, bounds.end)
    .map((slice) => timesheetTable(rows, slice, surcharges))
    .join("");
}
