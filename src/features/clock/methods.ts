import type { Enums } from "@/types/database";

export type ClockMethodChoice = "inherit" | "manual" | "app";

export const CLOCK_METHOD_CHOICES: readonly {
  id: ClockMethodChoice;
  label: string;
}[] = [
  { id: "inherit", label: "Impostazione sede" },
  { id: "manual", label: "Manuale" },
  { id: "app", label: "App" },
];

export function clockMethodChoice(
  method: Enums<"clock_method"> | null
): ClockMethodChoice {
  if (method === "manual" || method === "app") return method;
  return "inherit";
}

export function clockMethodLabel(method: Enums<"clock_method">): string {
  switch (method) {
    case "manual":
      return "Manuale";
    case "app":
      return "App";
    case "qr":
      return "QR";
    case "geolocation":
      return "Posizione";
  }
}

export function clockMethodDescription(
  method: Enums<"clock_method">
): string {
  switch (method) {
    case "manual":
      return "Il professionista non timbra: le ore vengono inserite da chi gestisce.";
    case "app":
      return "Il professionista timbra entrata e uscita direttamente dall’app.";
    case "qr":
      return "Il professionista timbra scansionando il QR dinamico della sede.";
    case "geolocation":
      return "Il professionista timbra dall’app con verifica della posizione.";
  }
}

export function effectiveClockMethod(
  override: Enums<"clock_method"> | null,
  venueDefault: Enums<"clock_method">
): Enums<"clock_method"> {
  return override ?? venueDefault;
}
