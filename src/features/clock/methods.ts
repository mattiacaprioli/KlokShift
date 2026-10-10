import type { Enums } from "@/types/database";

export type ClockMethodChoice = "inherit" | "manual" | "app";

export const CLOCK_METHOD_CHOICES: readonly {
  id: ClockMethodChoice;
  label: string;
}[] = [
  { id: "inherit", label: "Come la sede" },
  { id: "manual", label: "Nessuna timbratura" },
  { id: "app", label: "Timbratura dall’app" },
];

export function clockMethodChoice(
  method: Enums<"clock_method"> | null
): ClockMethodChoice {
  if (method === "manual" || method === "app") return method;
  return "inherit";
}

/**
 * Le etichette dicono cosa fa il professionista, non ripetono l'enum: anche
 * QR e posizione passano dall'app, `app` è quello senza prove.
 */
export function clockMethodLabel(method: Enums<"clock_method">): string {
  switch (method) {
    case "manual":
      return "Nessuna timbratura";
    case "app":
      return "Timbratura dall’app";
    case "qr":
      return "Timbratura con QR";
    case "geolocation":
      return "Timbratura con posizione";
  }
}

export function clockMethodDescription(
  method: Enums<"clock_method">
): string {
  switch (method) {
    case "manual":
      return "Il professionista non timbra: le ore del turno concluso si contano automaticamente e chi gestisce può correggerle.";
    case "app":
      return "Il professionista timbra entrata e uscita direttamente dall’app.";
    case "qr":
      return "Il professionista timbra scansionando il QR dinamico della sede.";
    case "geolocation":
      return "Il professionista timbra dall’app con verifica della posizione.";
  }
}

/** Il suggerimento sotto «Come la sede»: cosa succede, non il nome del metodo. */
export function inheritedClockMethodHint(
  venueMethod: Enums<"clock_method">
): string {
  return `Segue l’impostazione della sede. ${clockMethodDescription(venueMethod)}`;
}

/**
 * Timbratura senza turno: stesse parole in app e dashboard. Il turno nasce
 * all'uscita e resta da approvare, quindi la descrizione lo dice.
 */
export const CLOCK_UNPLANNED_LABEL = "Può timbrare anche senza turno";
export const CLOCK_UNPLANNED_DESCRIPTION =
  "Se non ha un turno in corso, timbra entrata e uscita dall’app: all’uscita nasce un turno «Fuori turno» con quegli orari, da approvare.";

export function clockUnplannedSummary(enabled: boolean): string {
  return enabled ? "Può timbrare anche senza turno" : "Solo sui turni assegnati";
}

export function effectiveClockMethod(
  override: Enums<"clock_method"> | null,
  venueDefault: Enums<"clock_method">
): Enums<"clock_method"> {
  return override ?? venueDefault;
}
