// Costruttori puri dei documenti di export (ore/presenze).
//
// Volutamente SENZA import Expo/React Native: questo modulo è condiviso con la
// dashboard web (`web/`), che riusa gli stessi identici output e sostituisce solo
// l'ultimo passo — Print/Sharing/FileSystem su mobile, Blob/window.print() su web.
// Il rendering nativo sta in `src/lib/export.ts`, che importa da qui.

import type { PersonHours } from "@/features/assignments/hoursSummary";

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

/** Quante sedi compaiono: con una sola, documenti identici a prima del multi-sede. */
function venuesInData(people: PersonHours[]): number {
  const ids = new Set<string>();
  for (const p of people) for (const v of p.venues) ids.add(v.venue_id);
  return ids.size;
}

/**
 * Tabella HTML stampabile (scuro-su-bianco, accento gold). Solo ore/presenze.
 *
 * Il PDF lo legge una **persona**, e al titolare serve anche sapere dove sono
 * finite quelle ore: la riga della persona porta il totale (quello della busta
 * paga) e sotto, rientrate, le sue sedi. Con una sola sede nei dati le righe
 * figlie non ci sono e il documento è identico a quello di prima.
 */
export function buildHoursHtml(
  companyName: string,
  monthLabel: string,
  people: PersonHours[],
  totalHours: number
): string {
  const totalShifts = people.reduce((s, p) => s + p.shifts_count, 0);
  const venues = venuesInData(people);
  const multi = venues > 1;

  /** Nome della sede, col perché-c'è quando è chiusa. */
  const venueLabel = (v: PersonHours["venues"][number]) =>
    escapeHtml(v.venue_name) + (v.venue_closed ? " (chiusa)" : "");

  const body = people
    .map((p) => {
      // Le righe figlie solo a chi ha davvero più di una sede: per gli altri il
      // nome della sede sta in colonna, e una riga figlia che ripete lo stesso
      // totale sarebbe rumore. Stessa forma della tabella sul web.
      const split = p.venues.length > 1;
      const sede = split
        ? `${p.venues.length} sedi`
        : p.venues[0]
          ? venueLabel(p.venues[0])
          : "—";

      const main =
        `<tr${split ? ' class="grp"' : ""}><td>${escapeHtml(p.person_name)}</td>` +
        (multi ? `<td>${sede}</td>` : "") +
        `<td>${escapeHtml(p.roles ?? "—")}</td>` +
        `<td class="n">${p.shifts_count}</td>` +
        `<td class="n">${hoursNumber(p.hours)}</td></tr>`;

      if (!split) return main;
      const children = p.venues
        .map(
          (v) =>
            `<tr class="sub-row"><td class="ind">↳</td>` +
            `<td>${venueLabel(v)}</td>` +
            `<td>${escapeHtml(v.roles ?? "—")}</td>` +
            `<td class="n">${v.shifts_count}</td>` +
            `<td class="n">${hoursNumber(v.hours)}</td></tr>`
        )
        .join("");
      return main + children;
    })
    .join("");

  const sub = `${escapeHtml(companyName)} · ${escapeHtml(monthLabel)}${
    multi ? ` · ${venues} sedi` : ""
  }`;

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
    /* Solo quando ci sono più sedi: la riga della persona è il totale, quelle
       rientrate sotto dicono da dove viene. */
    tr.grp td { font-weight: 700; border-bottom: none; }
    tr.sub-row td { color: #6a6358; font-size: 12px; padding-top: 4px; padding-bottom: 4px; }
    td.ind { padding-left: 22px; }
    .accent { height: 4px; width: 48px; background: #eab54c; border-radius: 2px; margin-bottom: 16px; }
    .foot { margin-top: 28px; color: #a49a8a; font-size: 11px; }
  </style></head><body>
    <div class="accent"></div>
    <h1>Ore tracciate</h1>
    <div class="sub">${sub}</div>
    <table>
      <thead><tr><th>Nome</th>${
        multi ? "<th>Sede</th>" : ""
      }<th>Ruolo</th><th class="n">Turni</th><th class="n">Ore</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Totale</td>${
        multi ? "<td></td>" : ""
      }<td></td><td class="n">${totalShifts}</td><td class="n">${hoursNumber(
        totalHours
      )}</td></tr></tfoot>
    </table>
    <div class="foot">Documento generato da topWaitr · riepilogo ore/presenze del personale interno.</div>
  </body></html>`;
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV separatore ';' e decimali con virgola (default Excel IT), con BOM UTF-8.
 *
 * **Una riga per persona, col totale.** Al commercialista serve quante ore ha fatto
 * Mattia, non in quale dei tre locali le ha fatte: è una busta paga sola. Lo split
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
 * Nome file condiviso mobile/web: "ore-osteria-milano-settembre-2026.csv" per chi
 * ha un locale solo, "ore-giuseppe-buffa-settembre-2026.csv" per chi ne ha tre.
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
  const slug = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      // Via gli accenti: un nome file con "è" o "à" viaggia male tra sistemi.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `ore-${slug(companyName)}-${slug(monthLabel)}.${ext}`;
}
