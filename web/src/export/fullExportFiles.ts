import { z } from "zod";

/*
 * Export completo dell'azienda (`export_workspace_data`): dai dati del server ai
 * file del pacchetto. Stesse convenzioni dei CSV della pagina Ore: separatore
 * ';', decimali con la virgola, BOM UTF-8 per Excel e testo protetto dalle
 * formule. Le date sono nell'ora italiana. Nessuna rete qui: solo composizione.
 */

const text = z.string().nullable();
const maybe = <T extends z.ZodType>(t: T) => t.nullable().optional();
const num = z.union([z.number(), z.string()]).nullable();

export const fullExportSchema = z.object({
  generated_at: z.string(),
  workspace: z.object({ id: z.string(), name: z.string(), created_at: z.string() }),
  documents_included: z.boolean(),
  venues: z.array(z.object({ name: z.string(), address: maybe(text), city: maybe(text), created_at: z.string(), closed_at: text })),
  people: z.array(z.object({
    name: z.string(), email: text, phone: text, authority: z.string(), status: z.string(),
    joined_at: z.string(), left_at: text, contract_hours: num, contract_period: text, hr_note: text,
    venues: z.array(z.object({ venue: z.string(), employment_type: text, left_at: text, roles: z.string() })),
  })),
  shifts: z.array(z.object({
    date: z.string(), venue: z.string(), title: z.string(), start_time: z.string(), end_time: z.string(),
    break_minutes: num, break_paid: z.boolean().nullable(), status: z.string(), unplanned: z.boolean().nullable(),
    positions_total: num, description: text,
  })),
  attendance: z.array(z.object({
    date: z.string(), venue: z.string(), shift: z.string(), start_time: z.string(), end_time: z.string(),
    person: z.string(), role: text, status: z.string(), confirmed_at: text, clock_method: text,
    clock_in_at: text, clock_out_at: text, clock_break_minutes: num, corrected: z.boolean(),
    correction_reason: text, worked_hours: num, hours_source: text, reviewed_at: text,
  })),
  absences: z.array(z.object({
    person: z.string(), kind: z.string(), start_date: z.string(), end_date: z.string(),
    start_time: text, end_time: text, status: z.string(), recognized_minutes: num,
    inps_protocol: text, note: text, resolution_note: text, created_at: z.string(),
  })),
  documents: z.array(z.object({
    person: z.string(), name: z.string(), mime_type: text, size_bytes: num, expires_at: text,
    created_at: z.string(), storage_path: z.string(),
  })).nullable(),
});
export type FullExport = z.infer<typeof fullExportSchema>;

const LABELS: Record<string, string> = {
  owner: "Titolare", collaborator: "Collaboratore", none: "Dipendente",
  active: "Attivo", invited: "Invitato", left: "Uscito",
  fisso: "Fisso", a_chiamata: "A chiamata",
  open: "Aperto", closed: "Completo", cancelled: "Annullato",
  assigned: "Assegnato", confirmed: "Confermato", declined: "Rifiutato", no_show: "Assente",
  pending: "In attesa", approved: "Approvata", rejected: "Rifiutata", withdrawn: "Ritirata",
  ferie: "Ferie", permesso: "Permesso", malattia: "Malattia",
  manual: "Manuale", app: "App", qr: "QR", geolocation: "Posizione",
  clock: "Timbratura", manual_auto: "Orario del turno", clock_expected: "Timbratura (orario previsto)",
  week: "settimana", month: "mese",
};
const label = (v: string | null | undefined) => (v ? LABELS[v] ?? v : "");

function cell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
/** Testo: un inizio da formula (`=`, `+`, `-`, `@`) resta testo con l'apostrofo. */
function textCell(v: string | null | undefined): string {
  const s = v ?? "";
  return cell(/^[=+\-@\t\r\n]/.test(s) ? `'${s}` : s);
}
function numberCell(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100).replace(".", ",") : "";
}
const rome = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome",
});
function instant(v: string | null | undefined): string {
  if (!v) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? rome.format(new Date(t)).replace(",", "") : "";
}
function day(v: string | null | undefined): string {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
const time = (v: string | null | undefined) => (v ? v.slice(0, 5) : "");
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "Sì" : "No");

function csv(header: string[], rows: string[][]): string {
  return "﻿" + [header.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n") + "\r\n";
}

/** Nome di file sicuro (cartelle e sistemi diversi), senza perdere le lettere accentate. */
export function safeName(v: string): string {
  const s = v.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim();
  return (s || "senza nome").slice(0, 100);
}

/** Percorso del documento nel pacchetto: per persona, nomi doppi resi unici. */
export function documentPaths(docs: NonNullable<FullExport["documents"]>): string[] {
  const used = new Set<string>();
  return docs.map((d) => {
    const ext = /\.[a-z0-9]{1,8}$/i.exec(d.storage_path)?.[0] ?? "";
    const base = `documenti/${safeName(d.person)}/${safeName(d.name.replace(/\.[a-z0-9]{1,8}$/i, ""))}`;
    let path = `${base}${ext}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `${base} (${i})${ext}`;
    used.add(path.toLowerCase());
    return path;
  });
}

/** I file di testo del pacchetto (i documenti si aggiungono a parte). */
export function fullExportFiles(data: FullExport, missingDocuments: string[] = []): Record<string, string> {
  const files: Record<string, string> = {};
  files["sedi.csv"] = csv(["Sede", "Indirizzo", "Città", "Creata il", "Chiusa il"],
    data.venues.map((v) => [textCell(v.name), textCell(v.address), textCell(v.city), instant(v.created_at), instant(v.closed_at)]));
  files["persone.csv"] = csv(
    ["Nome", "Email", "Telefono", "Ruolo in azienda", "Stato", "Ingresso", "Uscita", "Sedi", "Contratto per sede",
      "Mansioni", "Ore da contratto", "Periodo ore", "Nota HR"],
    data.people.map((p) => [textCell(p.name), textCell(p.email), textCell(p.phone), label(p.authority), label(p.status),
      instant(p.joined_at), instant(p.left_at),
      textCell(p.venues.map((v) => v.venue + (v.left_at ? ` (fino al ${instant(v.left_at).slice(0, 10)})` : "")).join(", ")),
      textCell(p.venues.map((v) => `${v.venue}: ${label(v.employment_type) || "—"}`).join(", ")),
      textCell(p.venues.filter((v) => v.roles).map((v) => `${v.venue}: ${v.roles}`).join(" | ")),
      numberCell(p.contract_hours), label(p.contract_period), textCell(p.hr_note)]));
  files["turni.csv"] = csv(
    ["Data", "Sede", "Turno", "Inizio", "Fine", "Pausa (min)", "Pausa retribuita", "Stato", "Fuori turno", "Persone previste", "Note"],
    data.shifts.map((s) => [day(s.date), textCell(s.venue), textCell(s.title), time(s.start_time), time(s.end_time),
      numberCell(s.break_minutes), yesNo(s.break_paid), label(s.status), yesNo(s.unplanned), numberCell(s.positions_total),
      textCell(s.description)]));
  files["presenze.csv"] = csv(
    ["Data", "Sede", "Turno", "Inizio previsto", "Fine prevista", "Persona", "Mansione", "Stato", "Confermato il",
      "Timbratura", "Entrata", "Uscita", "Pausa timbrata (min)", "Corretta", "Motivo correzione", "Ore lavorate approvate",
      "Fonte delle ore", "Approvata il"],
    data.attendance.map((a) => [day(a.date), textCell(a.venue), textCell(a.shift), time(a.start_time), time(a.end_time),
      textCell(a.person), textCell(a.role), label(a.status), instant(a.confirmed_at), label(a.clock_method),
      instant(a.clock_in_at), instant(a.clock_out_at), numberCell(a.clock_break_minutes), a.corrected ? "Sì" : "No",
      textCell(a.correction_reason), numberCell(a.worked_hours), label(a.hours_source), instant(a.reviewed_at)]));
  files["assenze.csv"] = csv(
    ["Persona", "Tipo", "Dal", "Al", "Dalle", "Alle", "Stato", "Ore riconosciute", "Protocollo INPS", "Nota", "Nota della risposta", "Registrata il"],
    data.absences.map((a) => [textCell(a.person), label(a.kind), day(a.start_date), day(a.end_date), time(a.start_time),
      time(a.end_time), label(a.status), numberCell(a.recognized_minutes === null ? null : Number(a.recognized_minutes) / 60),
      textCell(a.inps_protocol), textCell(a.note), textCell(a.resolution_note), instant(a.created_at)]));
  if (data.documents) {
    const paths = documentPaths(data.documents);
    files["documenti.csv"] = csv(["Persona", "Documento", "Scadenza", "Caricato il", "File nel pacchetto"],
      data.documents.map((d, i) => [textCell(d.person), textCell(d.name), day(d.expires_at), instant(d.created_at),
        missingDocuments.includes(d.storage_path) ? "Non scaricato: riprova l'export" : textCell(paths[i])]));
  }
  files["leggimi.txt"] = [
    `Export completo di ${data.workspace.name} su KlokShift`,
    `Creato il ${instant(data.generated_at)} (ora italiana).`,
    "",
    "sedi.csv        le sedi, anche chiuse",
    "persone.csv     le schede del personale, anche di chi è uscito, con sedi, contratto e nota HR",
    "turni.csv       tutti i turni, anche annullati",
    "presenze.csv    ogni persona su ogni turno: conferma, timbratura (corretta se c'è una correzione), ore lavorate approvate",
    "assenze.csv     ferie, permessi e malattie con le ore riconosciute",
    data.documents ? "documenti.csv   l'elenco dei documenti; i file sono nella cartella documenti/, divisi per persona"
      : "Documenti non inclusi: servono i permessi sui documenti del personale.",
    "",
    "I CSV usano il punto e virgola e la virgola per i decimali: si aprono direttamente in Excel.",
    "Le ore lavorate sono quelle approvate; le assenze non sono ore lavorate. KlokShift non calcola importi né buste paga.",
    "Le chat non sono incluse.",
    ...(missingDocuments.length ? ["", `${missingDocuments.length} documenti non sono stati scaricati: riprova l'export.`] : []),
    "",
  ].join("\r\n");
  return files;
}

export function fullExportFileName(workspaceName: string, at: Date = new Date()): string {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(at);
  return `${safeName(workspaceName)} - export completo ${d}.zip`;
}
