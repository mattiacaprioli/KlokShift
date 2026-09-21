// Costruttori puri dei documenti di export (ore/presenze).
//
// Volutamente SENZA import Expo/React Native: questo modulo è condiviso con la
// dashboard web (`web/`), che riusa gli stessi identici output e sostituisce solo
// l'ultimo passo — Print/Sharing/FileSystem su mobile, Blob/window.print() su web.
// Il rendering nativo sta in `src/lib/export.ts`, che importa da qui.

import type { PersonHours } from "@/features/assignments/hoursSummary";
import {
  ABSENCE_SUMMARY_NOTE,
  type AbsenceSummaryRow,
} from "@/features/absences/summary";

// Ore come numero italiano (virgola, senza suffisso): "12,5" · "5".
function hoursNumber(h: number): string {
  const r = Math.round(h * 10) / 10;
  return (r % 1 === 0 ? String(r) : r.toFixed(1)).replace(".", ",");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  monthLabel: string,
  people: PersonHours[],
  totalHours: number,
  /** Ferie, permessi e malattia del mese: una seconda tabella, se ce ne sono. */
  absences: AbsenceSummaryRow[] = []
): string {
  const totalShifts = people.reduce((s, p) => s + p.shifts_count, 0);

  const body = people
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.person_name)}</td>` +
        `<td>${escapeHtml(p.roles ?? "—")}</td>` +
        `<td class="n">${p.shifts_count}</td>` +
        `<td class="n">${hoursNumber(p.hours)}</td></tr>`
    )
    .join("");

  const sub = `${escapeHtml(companyName)} · ${escapeHtml(monthLabel)}`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1206; margin: 32px; }
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
  </style></head><body>
    <div class="accent"></div>
    <h1>Ore tracciate</h1>
    <div class="sub">${sub}</div>
    <table>
      <thead><tr><th>Nome</th><th>Ruolo</th><th class="n">Turni</th><th class="n">Ore</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Totale</td><td></td><td class="n">${totalShifts}</td><td class="n">${hoursNumber(
        totalHours
      )}</td></tr></tfoot>
    </table>
    ${absences.length > 0 ? absencesHtmlSection(absences) : ""}
    <div class="foot">Documento generato da KlokShift · riepilogo ore/presenze del personale interno.</div>
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
 * CSV separatore ';' e decimali con virgola (default Excel IT), con BOM UTF-8.
 *
 * **Una riga per persona, col totale.** Al commercialista serve quante ore ha fatto
 * Mattia, non in quale delle tre sedi le ha fatte: è una busta paga sola. Lo split
 * per sede serve al titolare per allocare i costi, e sta nella pagina Ore e nel PDF.
 *
 * Lo schema non cambia mai — `Nome;Ruolo;Turni;Ore` con una sede come con tre —
 * così un foglio o una macro che legge questo file continua a funzionare.
 */
export function buildHoursCsv(people: PersonHours[]): string {
  const header = "Nome;Ruolo;Turni;Ore";
  const lines = people.map((p) =>
    [
      p.person_name,
      p.roles ?? "",
      String(p.shifts_count),
      hoursNumber(p.hours),
    ]
      .map(csvCell)
      .join(";")
  );
  return "﻿" + [header, ...lines].join("\r\n");
}

/**
 * CSV delle assenze del mese: **un file a parte**, non colonne in più nel CSV
 * delle ore, il cui schema non cambia mai (vedi `buildHoursCsv`).
 *
 * Stesse convenzioni: ';', decimali con virgola, BOM. I giorni sono di
 * calendario, e l'intestazione lo dice, perché un CSV non ha una nota a piè di
 * pagina. Le celle vuote valgono zero: un foglio le somma senza lamentarsi.
 */
export function buildAbsencesCsv(rows: AbsenceSummaryRow[]): string {
  const header = [
    "Nome",
    "Ferie (giorni di calendario)",
    "Permessi (giorni)",
    "Permessi (ore)",
    "Malattia (giorni di calendario)",
    "Riferimenti certificati medici",
  ].join(";");
  const num = (n: number) => (n > 0 ? hoursNumber(n) : "0");
  const lines = rows.map((r) =>
    [
      r.person_name,
      num(r.ferie_days),
      num(r.permesso_days),
      num(r.permesso_hours),
      num(r.malattia_days),
      r.inps_protocols ?? "",
    ]
      .map(csvCell)
      .join(";")
  );
  return "\uFEFF" + [header, ...lines].join("\r\n");
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
 * `companyName()`, con la stessa regola di `chat_counterpart`: se al professionista
 * in chat compare "Giuseppe Buffa", al commercialista non può comparire
 * "Trattoria Roma".
 */
export function hoursFileName(
  companyName: string,
  monthLabel: string,
  ext: string
): string {
  return exportFileName("ore", companyName, monthLabel, ext);
}

/** "assenze-osteria-milano-settembre-2026.csv": stessa regola di `hoursFileName`. */
export function absencesFileName(
  companyName: string,
  monthLabel: string,
  ext: string
): string {
  return exportFileName("assenze", companyName, monthLabel, ext);
}

function exportFileName(
  prefix: string,
  companyName: string,
  monthLabel: string,
  ext: string
): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      // Via gli accenti: un nome file con "è" o "à" viaggia male tra sistemi.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug(companyName)}-${slug(monthLabel)}.${ext}`;
}
