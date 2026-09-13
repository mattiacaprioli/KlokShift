// Costruttori puri dei documenti di export (ore/presenze).
//
// Volutamente SENZA import Expo/React Native: questo modulo è condiviso con la
// dashboard web (`web/`), che riusa gli stessi identici output e sostituisce solo
// l'ultimo passo — Print/Sharing/FileSystem su mobile, Blob/window.print() su web.
// Il rendering nativo sta in `src/lib/export.ts`, che importa da qui.

import type { StaffHoursRow } from "@/features/assignments/api";

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

/** Tabella HTML stampabile (scuro-su-bianco, accento gold). Solo ore/presenze. */
export function buildHoursHtml(
  venueName: string,
  monthLabel: string,
  rows: StaffHoursRow[],
  totalHours: number
): string {
  const totalShifts = rows.reduce((s, r) => s + r.shifts_count, 0);
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.display_name)}</td><td>${escapeHtml(
          r.roles ?? "—"
        )}</td><td class="n">${r.shifts_count}</td><td class="n">${hoursNumber(
          r.hours
        )}</td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1206; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    .sub { color: #6a6358; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e7e2d8; }
    th { color: #8c857a; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    td.n, th.n { text-align: right; }
    tfoot td { font-weight: 700; border-top: 2px solid #eab54c; border-bottom: none; }
    .accent { height: 4px; width: 48px; background: #eab54c; border-radius: 2px; margin-bottom: 16px; }
    .foot { margin-top: 28px; color: #a49a8a; font-size: 11px; }
  </style></head><body>
    <div class="accent"></div>
    <h1>Ore tracciate</h1>
    <div class="sub">${escapeHtml(venueName)} · ${escapeHtml(monthLabel)}</div>
    <table>
      <thead><tr><th>Nome</th><th>Ruolo</th><th class="n">Turni</th><th class="n">Ore</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Totale</td><td></td><td class="n">${totalShifts}</td><td class="n">${hoursNumber(
        totalHours
      )}</td></tr></tfoot>
    </table>
    <div class="foot">Documento generato da topWaitr · riepilogo ore/presenze del personale interno.</div>
  </body></html>`;
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV separatore ';' e decimali con virgola (default Excel IT), con BOM UTF-8. */
export function buildHoursCsv(rows: StaffHoursRow[]): string {
  const header = "Nome;Ruolo;Turni;Ore";
  const lines = rows.map((r) =>
    [r.display_name, r.roles ?? "", String(r.shifts_count), hoursNumber(r.hours)]
      .map(csvCell)
      .join(";")
  );
  return "﻿" + [header, ...lines].join("\r\n");
}

/**
 * Nome file condiviso mobile/web: "ore-osteria-milano-settembre-2026.csv".
 *
 * Il nome della sede è dentro di proposito. Un titolare con tre locali esporta tre
 * volte lo stesso mese, e tre file "ore-settembre-2026.csv" nella cartella
 * Download sono indistinguibili — è l'allegato che va al commercialista, e sono
 * tre buste paga diverse.
 */
export function hoursFileName(
  venueName: string,
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
  return `ore-${slug(venueName)}-${slug(monthLabel)}.${ext}`;
}
