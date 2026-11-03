import { useMemo } from "react";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useHoursToFix } from "./hooks";
import {
  HOURS_TO_FIX_TITLE,
  homeHoursToFixPeriod,
  hoursToFixFirstMonth,
  hoursToFixSummary,
} from "./hoursToFix";

/**
 * L'avviso in Home: «Ore da sistemare · 3 turni · 24 h che non contano
 * ancora». Senza, chi non ha timbrato si scopriva solo aprendo la pagina Ore.
 * Sparisce quando non c'è niente; il tocco apre Ore sul mese del turno più
 * vecchio. Gemello di `web/src/hours/HoursToFixBanner`.
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
    <AlertBanner
      icon="clock"
      title={HOURS_TO_FIX_TITLE}
      subtitle={hoursToFixSummary(items)}
      className={className}
      onPress={() => onOpen(month)}
    />
  );
}
