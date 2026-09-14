import type { ShiftTone } from "@/features/assignments/coverage";

/**
 * Il bordo sinistro di un turno, per tono. Una mappa sola: settimana e mese
 * devono dire la stessa cosa con lo stesso colore, sennò la legenda vale per
 * una vista e mente sull'altra.
 */
export const TONE_BORDER: Record<ShiftTone, string> = {
  covered: "border-l-success",
  short: "border-l-warning",
  off: "border-l-t4",
};

/** Lo stesso, come fondo: serve al quadratino della legenda. */
const TONE_BG: Record<ShiftTone, string> = {
  covered: "bg-success",
  short: "bg-warning",
  off: "bg-t4",
};

const ITEMS: { tone: ShiftTone; label: string }[] = [
  { tone: "covered", label: "coperto" },
  { tone: "short", label: "mancano persone" },
  { tone: "off", label: "annullato o chiuso" },
];

/**
 * Cosa vogliono dire i bordi colorati. Sta sotto la griglia in tutte le viste a
 * calendario — un colore che non si può imparare da nessuna parte è una
 * decorazione, non un segnale — e si stampa insieme al turnario, dove i colori
 * diventano tre grigi diversi e la legenda è l'unico modo per distinguerli.
 */
export function CoverageLegend({ className }: { className?: string }) {
  return (
    <p className={className ?? "mt-3 flex flex-wrap gap-4 text-xs text-t4"}>
      {ITEMS.map((i) => (
        <span key={i.tone} className="flex items-center gap-1.5">
          <span className={`h-3 w-0.5 rounded ${TONE_BG[i.tone]}`} /> {i.label}
        </span>
      ))}
    </p>
  );
}
