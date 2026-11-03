import { useMemo } from "react";
import { useHoursToFix } from "@/features/assignments/hooks";
import {
  HOURS_TO_FIX_TITLE,
  homeHoursToFixPeriod,
  hoursToFixFirstMonth,
  hoursToFixSummary,
} from "@/features/assignments/hoursToFix";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { cn } from "@/lib/cn";

/**
 * L'avviso in Home: «Ore da sistemare · 3 turni · 24 h che non contano
 * ancora». Senza, chi non ha timbrato si scopriva solo aprendo la pagina Ore.
 * Sparisce quando non c'è niente; il clic apre Ore sul mese del turno più
 * vecchio. Gemello di `src/features/assignments/HoursToFixBanner`.
 */
export function HoursToFixBanner({
  onOpen,
  className,
}: {
  onOpen: (month: string) => void;
  className?: string;
}) {
  const { workspaceId, canAny } = useOwnerVenues();
  const period = useMemo(() => homeHoursToFixPeriod(), []);
  const items =
    useHoursToFix(canAny("can_view_hours") ? workspaceId : undefined, period).data ?? [];
  const month = hoursToFixFirstMonth(items);
  if (!month) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(month)}
      className={cn(
        "focus-gold mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-left transition hover:bg-warning/15 print:hidden",
        className,
      )}
    >
      <span className="text-sm">
        <span className="font-semibold text-warning">{HOURS_TO_FIX_TITLE}</span>
        <span className="text-t2"> · {hoursToFixSummary(items)}</span>
      </span>
      <span aria-hidden className="text-warning">
        →
      </span>
    </button>
  );
}
