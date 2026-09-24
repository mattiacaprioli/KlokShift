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

export function effectiveClockMethod(
  override: Enums<"clock_method"> | null,
  venueDefault: Enums<"clock_method">
): Enums<"clock_method"> {
  return override ?? venueDefault;
}
