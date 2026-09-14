import { useState } from "react";
import {
  useOwnerPastShifts,
  useOwnerPastShiftsCount,
} from "@/features/shifts/hooks";
import { formatDate, formatShiftRange } from "@/lib/format";
import { shiftCounts } from "@/features/assignments/coverage";
import type { Shift } from "@/features/shifts/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { ShiftPanel } from "../shifts/ShiftPanel";
import {
  Button,
  Card,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

/**
 * Turni passati, dal più recente. Paginati (20 per volta) con la stessa infinite
 * query dell'app: lo storico di un locale attivo cresce senza limiti, caricarlo
 * tutto sarebbe un problema in poche settimane.
 */
export function StoricoPage() {
  const { venues } = useOwnerVenues();
  // Il dettaglio si apre qui sopra, senza cambiare rotta: mandare l'utente sul
  // Planning gli faceva perdere lo storico e riportava il calendario indietro.
  const [panel, setPanel] = useState<Shift | null>(null);
  const count = useOwnerPastShiftsCount().data ?? 0;
  const { data, isPending, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useOwnerPastShifts();

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Storico" />
        <NoVenues detail="I turni svolti compariranno qui." />
      </>
    );
  }

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  const shifts = data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <>
      <PageHeader
        title="Storico"
        subtitle={`${count} turni svolti`}
      />

      {shifts.length === 0 ? (
        <Placeholder
          title="Nessun turno passato"
          detail="Qui finiscono i turni una volta conclusi."
        />
      ) : (
        <>
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-2 text-left text-[11px] uppercase tracking-wider text-t3">
                  <th className="px-5 py-3 font-semibold">Data</th>
                  <th className="px-5 py-3 font-semibold">Turno</th>
                  <th className="px-5 py-3 font-semibold">Orario</th>
                  <th className="px-5 py-3 text-right font-semibold">Coperti</th>
                  <th className="px-5 py-3 font-semibold">Stato</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => {
                  const counts = shiftCounts(s);
                  return (
                  <tr
                    key={s.id}
                    onClick={() => setPanel(s)}
                    className="cursor-pointer border-b border-border transition last:border-0 hover:bg-bg-1"
                  >
                    <td className="px-5 py-2.5 text-t2">{formatDate(s.date)}</td>
                    <td className="px-5 py-2.5 text-t1">{s.title}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-t3">
                      {formatShiftRange(s.start_time, s.end_time)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-t2">
                      {counts.filled}/{counts.total}
                    </td>
                    <td className="px-5 py-2.5">
                      {s.status === "cancelled" ? (
                        <Pill tone="error">Annullato</Pill>
                      ) : (
                        <Pill tone="neutral">Concluso</Pill>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Caricamento…" : "Carica altri"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {panel ? (
        <ShiftPanel
          date={panel.date}
          shift={panel}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </>
  );
}
