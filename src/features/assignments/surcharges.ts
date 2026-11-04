import { addMonthsToKey, formatMonthKey } from "@/lib/format";

// Le maggiorazioni (notturno, domenica, festivi, straordinario) come le dà
// `get_workspace_surcharges`, e le regole come le dà `get_surcharge_rules`.
//
// Modulo **puro** (nessun import di Supabase, Expo o React): lo usano la pagina
// Ore e i costruttori degli export, condivisi con la dashboard web. Le ore le
// calcola solo il database: qui si raggruppano e si scrivono, mai si ricalcolano.

export type SurchargeKind = "night" | "sunday" | "holiday" | "overtime";

/** L'ordine in cui le voci compaiono, a video e nei file. */
export const SURCHARGE_KINDS: readonly SurchargeKind[] = ["night", "sunday", "holiday", "overtime"];

const NAMES: Record<SurchargeKind, string> = {
  night: "notturno",
  sunday: "domenica",
  holiday: "festivi",
  overtime: "straordinario",
};

/** Una porzione di una riga di lavoro: stessa persona, giorno, sede, turno e orari. */
export type SurchargeRow = {
  person_id: string;
  person_name: string;
  date: string;
  venue_name: string | null;
  title: string | null;
  clock_in: string | null;
  clock_out: string | null;
  kind: SurchargeKind;
  percentage: number;
  hours: number;
};

export type Surcharges = {
  rows: SurchargeRow[];
  /** Dipendenti con ore nel periodo e senza ore da contratto (straordinario acceso). */
  noContract: Set<string>;
};

const isKind = (k: unknown): k is SurchargeKind =>
  typeof k === "string" && (SURCHARGE_KINDS as readonly string[]).includes(k);

type DbSurchargeRow = {
  member_id?: unknown;
  member_name?: unknown;
  date?: unknown;
  venue_name?: unknown;
  title?: unknown;
  clock_in?: unknown;
  clock_out?: unknown;
  kind?: unknown;
  percentage?: unknown;
  hours?: unknown;
};

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toSurcharges(raw: readonly unknown[]): Surcharges {
  const rows: SurchargeRow[] = [];
  const noContract = new Set<string>();
  for (const item of raw as DbSurchargeRow[]) {
    if (typeof item?.member_id !== "string") continue;
    if (item.kind === "no_contract") {
      noContract.add(item.member_id);
      continue;
    }
    if (!isKind(item.kind) || typeof item.date !== "string") continue;
    rows.push({
      person_id: item.member_id,
      person_name: typeof item.member_name === "string" ? item.member_name : "",
      date: item.date,
      venue_name: textOrNull(item.venue_name),
      title: textOrNull(item.title),
      clock_in: textOrNull(item.clock_in),
      clock_out: textOrNull(item.clock_out),
      kind: item.kind,
      percentage: Number(item.percentage),
      hours: Number(item.hours),
    });
  }
  return { rows, noContract };
}

const pctText = (pct: number) => String(pct).replace(".", ",");

/** «Di cui notturno +20%»: riga a video, causale del giornaliero, colonna del mensile. */
export function surchargeLabel(kind: SurchargeKind, pct: number): string {
  return `Di cui ${NAMES[kind]} +${pctText(pct)}%`;
}

const columnKey = (kind: SurchargeKind, pct: number) => `${kind}:${pct}`;

/**
 * Le colonne (e le righe «di cui») del periodo: una per voce **e** percentuale,
 * perché in un periodo di più mesi la stessa voce può aver cambiato percentuale.
 */
export function surchargeColumns(
  rows: readonly SurchargeRow[]
): { kind: SurchargeKind; percentage: number }[] {
  const seen = new Map<string, { kind: SurchargeKind; percentage: number }>();
  for (const r of rows) seen.set(columnKey(r.kind, r.percentage), { kind: r.kind, percentage: r.percentage });
  return [...seen.values()].sort(
    (a, b) =>
      SURCHARGE_KINDS.indexOf(a.kind) - SURCHARGE_KINDS.indexOf(b.kind) || a.percentage - b.percentage
  );
}

/** Ore per voce e percentuale (chiave `kind:pct`), di tutti o di una persona. */
export function surchargeTotals(
  rows: readonly SurchargeRow[],
  personId?: string
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (personId !== undefined && r.person_id !== personId) continue;
    const key = columnKey(r.kind, r.percentage);
    out.set(key, Math.round(((out.get(key) ?? 0) + r.hours) * 100) / 100);
  }
  return out;
}

/** La chiave di `surchargeTotals` per una colonna di `surchargeColumns`. */
export function surchargeColumnKey(c: { kind: SurchargeKind; percentage: number }): string {
  return columnKey(c.kind, c.percentage);
}

/**
 * L'avviso della pagina Ore: chi, fra le persone del periodo, non ha ore da
 * contratto e quindi non ha straordinario. Non blocca niente. `null` = niente.
 */
export function missingContractWarning(
  noContract: ReadonlySet<string>,
  personIds: readonly string[]
): string | null {
  const n = new Set(personIds.filter((id) => noContract.has(id))).size;
  if (n === 0) return null;
  return `${n === 1 ? "1 persona" : `${n} persone`} senza ore da contratto: lo straordinario non è calcolato.`;
}

export type SurchargeRulesInput = {
  night_pct: number | null;
  night_start: string;
  night_end: string;
  sunday_pct: number | null;
  holiday_pct: number | null;
  overtime_pct: number | null;
};

export type SurchargeRules = {
  versions: (SurchargeRulesInput & { valid_from: string })[];
  patrons: { venue_id: string; day: number; month: number }[];
};

const pctOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/** Dalla risposta di `get_surcharge_rules`; quel che manca è vuoto. */
export function toSurchargeRules(raw: unknown): SurchargeRules {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const versions = Array.isArray(obj.versions)
    ? (obj.versions as Record<string, unknown>[]).map((v) => ({
        valid_from: String(v.valid_from),
        night_pct: pctOrNull(v.night_pct),
        night_start: typeof v.night_start === "string" ? v.night_start : "22:00",
        night_end: typeof v.night_end === "string" ? v.night_end : "06:00",
        sunday_pct: pctOrNull(v.sunday_pct),
        holiday_pct: pctOrNull(v.holiday_pct),
        overtime_pct: pctOrNull(v.overtime_pct),
      }))
    : [];
  const patrons = Array.isArray(obj.patrons)
    ? (obj.patrons as Record<string, unknown>[])
        .filter((p) => typeof p.venue_id === "string")
        .map((p) => ({ venue_id: p.venue_id as string, day: Number(p.day), month: Number(p.month) }))
    : [];
  return { versions, patrons };
}

/** Dal testo del campo ("20", "12,5", "") alla percentuale; le regole sono quelle del database. */
export function parseSurchargePct(input: string): { pct: number | null; invalid: boolean } {
  const t = input.trim();
  if (t === "") return { pct: null, invalid: false };
  if (!/^\d{1,3}([.,]\d)?$/.test(t)) return { pct: null, invalid: true };
  const pct = Number(t.replace(",", "."));
  return pct > 0 && pct <= 300 ? { pct, invalid: false } : { pct: null, invalid: true };
}

/** Le righe «di cui» da mostrare (solo voci con ore), di tutti o di una persona. */
export function surchargeSummary(
  rows: readonly SurchargeRow[],
  personId?: string
): { label: string; hours: number }[] {
  const totals = surchargeTotals(rows, personId);
  return surchargeColumns(rows)
    .map((c) => ({ label: surchargeLabel(c.kind, c.percentage), hours: totals.get(surchargeColumnKey(c)) ?? 0 }))
    .filter((r) => r.hours > 0);
}

export const EMPTY_SURCHARGE_RULES: SurchargeRulesInput = {
  night_pct: null,
  night_start: "22:00",
  night_end: "06:00",
  sunday_pct: null,
  holiday_pct: null,
  overtime_pct: null,
};

/**
 * Le regole che valgono per il mese `YYYY-MM`: l'ultima versione partita entro
 * quel mese, come `private.surcharge_rules_at`. Prima della prima: tutto spento.
 */
export function rulesForMonth(
  versions: SurchargeRules["versions"],
  month: string
): SurchargeRulesInput {
  const first = `${month}-01`;
  const v = [...versions].filter((x) => x.valid_from <= first).sort((a, b) => a.valid_from.localeCompare(b.valid_from)).pop();
  if (!v) return { ...EMPTY_SURCHARGE_RULES };
  return {
    night_pct: v.night_pct,
    night_start: v.night_start,
    night_end: v.night_end,
    sunday_pct: v.sunday_pct,
    holiday_pct: v.holiday_pct,
    overtime_pct: v.overtime_pct,
  };
}

/** «22:00», «06:45»: la fascia notturna va al quarto d'ora, come vuole il database. */
export function isQuarterTime(input: string): boolean {
  return /^([01]\d|2[0-3]):(00|15|30|45)$/.test(input.trim());
}

/** Testi del modulo delle regole, uguali in app e sulla dashboard. */
export const SURCHARGES_HELP =
  "Le percentuali le decide il contratto: scrivile come te le dà il consulente. Le ore lavorate non cambiano: le maggiorazioni dicono quante di quelle ore sono notturne, di domenica, festive o di straordinario.";
export const OVERTIME_HELP = "Le ore oltre quelle da contratto della scheda, nel periodo del contratto.";
export const PATRON_HELP =
  "Il giorno del patrono della città di ogni sede conta come festivo. Vale anche per i mesi passati.";
export const PCT_ERROR = "Un numero fra 0 e 300, con al massimo un decimale.";
export const BAND_ERROR = "Orari al quarto d'ora (es. 22:00), diversi fra loro.";

/**
 * Cosa cambia salvando le regole del mese `month` (`YYYY-MM`), detto prima di
 * salvare: i file dei mesi passati cambiano, ma solo fino alla versione dopo,
 * se c'è (lei resta com'è). `null` = niente da dire.
 */
export function rulesChangeNote(
  versions: SurchargeRules["versions"],
  month: string,
  current: string
): string | null {
  const next = versions
    .map((v) => v.valid_from.slice(0, 7))
    .filter((m) => m > month)
    .sort()[0];
  const from = formatMonthKey(month);
  const future = month > current;
  if (!next) {
    if (future) return `Valgono da ${from}: fino ad allora restano le regole di prima.`;
    return month < current ? `I file dei mesi da ${from} in poi cambiano.` : null;
  }
  const last = addMonthsToKey(next, -1);
  const until = formatMonthKey(next);
  const changes = future
    ? last === month
      ? `Valgono solo per ${from}`
      : `Valgono da ${from} a ${formatMonthKey(last)}`
    : last === month
      ? `Cambia solo il file di ${from}`
      : `Cambiano solo i file da ${from} a ${formatMonthKey(last)}`;
  return `${changes}: da ${until} valgono le regole salvate per ${until}.`;
}

/**
 * Il patrono scritto nel modulo: giorno e mese interi e una data che esiste (il
 * 29 febbraio sì), oppure entrambi vuoti = nessun patrono. Come `save_venue_patron`.
 */
export function parsePatron(
  dayText: string,
  monthText: string
): { day: number | null; month: number | null } | "invalid" {
  const d = dayText.trim();
  const m = monthText.trim();
  if (d === "" && m === "") return { day: null, month: null };
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m)) return "invalid";
  const day = Number(d);
  const month = Number(m);
  if (month < 1 || month > 12 || day < 1) return "invalid";
  const daysInMonth = new Date(2024, month, 0).getDate();
  return day > daysInMonth ? "invalid" : { day, month };
}
export const PATRON_ERROR = "Giorno e mese di una data che esiste (es. 4 e 10), o entrambi vuoti.";
