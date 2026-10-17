import { addDaysToDate, formatMonthKey, MONTH_NAMES } from "@/lib/format";
import type { PersonOption } from "@/features/shifts/pastFilters";

/**
 * Il periodo e le persone della pagina Ore, condivisi da app e dashboard.
 *
 * **Quello che vedi è quello che esporti**: periodo e persone filtrano la
 * pagina e i tre export insieme, così il totale a schermo coincide col file che
 * parte verso il consulente.
 *
 * Il periodo va al database (le due RPC prendono `[p_from, p_to)` qualsiasi);
 * le persone si filtrano qui sulle righe ricevute, dentro il perimetro che la
 * RPC ha già deciso coi permessi.
 *
 * Nessun import di React o React Native: la dashboard web lo riusa verbatim.
 */
export type ReportPeriod =
  | { kind: "month"; month: string }
  /** Date DB `YYYY-MM-DD`, **entrambe incluse**, come le sceglie chi esporta. */
  | { kind: "range"; from: string; to: string };

/** Oltre un anno la pagina scaricherebbe troppo, e nessuna busta paga lo copre. */
export const MAX_RANGE_DAYS = 366;

/** Il primo del mese e il primo del mese dopo (fine esclusa). */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${month}-01`,
    end: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  };
}

/** Gli estremi per le RPC: `end` è **esclusa**, il giorno dopo l'ultimo scelto. */
export function periodBounds(p: ReportPeriod): { start: string; end: string } {
  if (p.kind === "month") return monthBounds(p.month);
  return { start: p.from, end: addDaysToDate(p.to, 1) };
}

/** La parte della chiave di cache che distingue un periodo dall'altro. */
export function periodKey(p: ReportPeriod): string {
  const { start, end } = periodBounds(p);
  return `${start}_${end}`;
}

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, month: MONTH_NAMES[m - 1] };
}

/**
 * «Ottobre 2026» · «1–15 ottobre 2026» · «28 settembre – 3 ottobre 2026» ·
 * «28 dicembre 2025 – 3 gennaio 2026». Finisce nel titolo del PDF e nel nome
 * del file, quindi dice il periodo per intero.
 */
export function periodLabel(p: ReportPeriod): string {
  if (p.kind === "month") {
    const label = formatMonthKey(p.month);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const a = parts(p.from);
  const b = parts(p.to);
  if (p.from === p.to) return `${a.d} ${a.month} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${a.month} ${a.y} – ${b.d} ${b.month} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.month} – ${b.d} ${b.month} ${b.y}`;
  return `${a.d}–${b.d} ${b.month} ${b.y}`;
}

/** Il messaggio da mostrare sotto le date, o `null` se l'intervallo va bene. */
export function validateRange(from: string, to: string): string | null {
  if (!from || !to) return "Scegli entrambe le date.";
  if (from > to) return "La data di inizio è dopo quella di fine.";
  if (to >= addDaysToDate(from, MAX_RANGE_DAYS)) {
    return "Scegli al massimo un anno.";
  }
  return null;
}

/** Il mese intero come intervallo: da dove parte chi passa da «Mese» a «Date». */
export function monthAsRange(month: string): { from: string; to: string } {
  const { start, end } = monthBounds(month);
  return { from: start, to: addDaysToDate(end, -1) };
}

/** `null` = tutte le persone. */
export function filterByPeople<T extends { person_id: string }>(
  rows: readonly T[],
  ids: readonly string[] | null
): T[] {
  if (!ids) return [...rows];
  const set = new Set(ids);
  return rows.filter((r) => set.has(r.person_id));
}

/**
 * Le persone che si possono scegliere: quelle che **nel periodo** hanno ore o
 * assenze. Così compare anche chi nel frattempo è uscito dall'azienda, e non
 * compare mai una voce che darebbe un export vuoto.
 */
export function peopleInReport(
  ...sources: readonly (readonly { person_id: string; person_name: string }[])[]
): PersonOption[] {
  const byId = new Map<string, string>();
  for (const rows of sources) {
    for (const r of rows) {
      if (!byId.has(r.person_id)) byId.set(r.person_id, r.person_name);
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

/**
 * Cambiando periodo si tengono solo le persone ancora presenti; se non ne
 * resta nessuna si torna a «Tutte», invece di una pagina vuota senza motivo.
 */
export function pruneSelection(
  ids: readonly string[] | null,
  options: readonly PersonOption[]
): string[] | null {
  if (!ids) return null;
  const present = new Set(options.map((o) => o.id));
  const kept = ids.filter((id) => present.has(id));
  return kept.length > 0 ? kept : null;
}

/** Accende o spegne una persona; tutte accese equivale a «Tutte». */
export function togglePerson(
  ids: readonly string[] | null,
  id: string,
  total: number
): string[] | null {
  const current = ids ?? [];
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  return next.length === 0 || next.length === total ? null : next;
}

/** I nomi delle persone scelte, nell'ordine dell'elenco; vuoto = tutti. */
export function selectedNames(
  ids: readonly string[] | null,
  options: readonly PersonOption[]
): string[] {
  if (!ids) return [];
  const set = new Set(ids);
  return options.filter((o) => set.has(o.id)).map((o) => o.name);
}

/** «Tutte» · «Anna Rossi» · «3 persone»: l'etichetta del selettore. */
export function selectionLabel(names: readonly string[]): string {
  if (names.length === 0) return "Tutte";
  if (names.length === 1) return names[0];
  return `${names.length} persone`;
}
