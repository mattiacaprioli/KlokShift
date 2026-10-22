import type { AdminFlag } from "@/features/admin/types";

/*
 * Etichette e formati dell'area fondatore, in un posto solo: prima ogni file
 * ne aveva una copia, e uno stato rinominato restava vecchio altrove.
 */

export const labels: Record<string, string> = {
  all: "Tutti", customer: "Cliente", internal: "Interno", test: "Test", unclassified: "Non classificato",
  setup: "Preparazione", operational: "Operativa", archive: "Archivio", expired: "Archivio scaduto",
  migration_pending: "Migrazione da verificare", unavailable: "Dati mancanti", deleted: "Eliminato",
  confirmed: "Confermato", unconfirmed: "Da confermare", anonymous: "Anonimo",
  owner: "Titolare", collaborator: "Collaboratore", none: "Professionista",
  active: "Attivo", invited: "Invitato", left: "Uscito",
  base: "Base", team: "Team", trial: "Prova", complimentary_lifetime: "Gratuito a vita",
  complimentary_temporary: "Concessione temporanea", transition: "Transizione",
  subscription: "Abbonamento", payment_grace: "Tolleranza pagamento",
};

export const flagLabels: Record<AdminFlag["code"], string> = {
  migration_pending: "Verificare la migrazione commerciale",
  commercial_data_missing: "Verificare i dati commerciali mancanti",
  trial_ending: "Prova in scadenza entro 7 giorni",
  archive_ending: "Archivio in scadenza entro 30 giorni",
  attendance_window: "Rettifiche pregresse ancora consentite",
  archive_expired: "Archivio scaduto: verificare il percorso di cancellazione",
  people_near_capacity: "Capacità persone prossima al limite",
  people_over_capacity: "Capacità persone superata",
  venues_over_capacity: "Capacità sedi superata",
  document_measurement_incomplete: "Dimensioni Storage incomplete",
};

export type Tone = "neutral" | "gold" | "success" | "warning" | "error";

/** Il colore di uno stato è lo stesso in ogni pagina: elenco, scheda, panoramica. */
export const stateTone: Record<string, Tone> = {
  operational: "success", setup: "gold", migration_pending: "warning", unavailable: "warning",
  expired: "error", archive: "neutral", deleted: "neutral",
  confirmed: "success", unconfirmed: "warning", anonymous: "neutral",
  active: "success", invited: "gold", left: "neutral",
};

export const severityTone: Record<AdminFlag["severity"], Tone> = {
  critical: "error", warning: "warning", info: "neutral",
};

const dateTime = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" });
const dateOnly = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeZone: "Europe/Rome" });
const timeOnly = new Intl.DateTimeFormat("it-IT", { timeStyle: "short", timeZone: "Europe/Rome" });

export function date(value: string | null | undefined) {
  return value ? dateTime.format(new Date(value)) : "Non disponibile";
}
export function day(value: string) {
  return dateOnly.format(new Date(value));
}
export function time(value: string) {
  return timeOnly.format(new Date(value));
}

const relativeFormat = new Intl.RelativeTimeFormat("it-IT", { numeric: "auto" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60],
];
/** «3 giorni fa», «fra 2 settimane»: la data esatta va nel `title`. */
export function relative(value: string | null | undefined, now = Date.now()) {
  if (!value) return "Mai";
  const seconds = (Date.parse(value) - now) / 1000;
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "adesso";
}

export function mib(value: number) {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value / 1048576) + " MiB";
}
/** Per i totali: oltre 1 GiB si legge meglio in GiB. */
export function bytes(value: number) {
  return value >= 1073741824
    ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value / 1073741824) + " GiB"
    : mib(value);
}

export const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
