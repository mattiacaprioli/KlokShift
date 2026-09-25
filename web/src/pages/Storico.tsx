import { useEffect, useState } from "react";
import {
  useOwnerPastShifts,
  useOwnerPastShiftsCount,
} from "@/features/shifts/hooks";
import {
  NO_PAST_FILTERS,
  hasPastFilters,
  type PastShiftsFilters as PastFilters,
} from "@/features/shifts/pastFilters";
import {
  formatDate,
  formatHoursVariance,
  formatShiftRange,
} from "@/lib/format";
import { shiftCounts } from "@/features/assignments/coverage";
import { clockAttentionForShift } from "@/features/clock/attention";
import { shiftDeviations } from "@/features/clock/hours";
import type { Shift, ShiftWithAssignees } from "@/features/shifts/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { PastShiftsFilters } from "../shifts/PastShiftsFilters";
import { ShiftPanel } from "../shifts/ShiftPanel";
import {
  Button,
  Card,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
  Spinner,
  StickyHeader,
} from "../ui/primitives";

/** Quanto si aspetta prima di interrogare il server mentre si digita. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Turni passati, dal più recente. Paginati (20 per volta) con la stessa infinite
 * query dell'app: lo storico di una sede attiva cresce senza limiti, caricarlo
 * tutto sarebbe un problema in poche settimane.
 *
 * Per lo stesso motivo **i filtri stanno nella query**: cercare "Capodanno" fra
 * le 20 righe già scaricate risponderebbe sulle ultime tre settimane e
 * chiamerebbe quel risultato "lo storico".
 */
export function StoricoPage() {
  const { venues, can, canAny } = useOwnerVenues();
  // Ore e timbrature sono dati del permesso Ore, come nel Planning.
  const showHours = canAny("can_view_hours");
  // Il dettaglio si apre qui sopra, senza cambiare rotta: mandare l'utente sul
  // Planning gli faceva perdere lo storico e riportava il calendario indietro.
  const [panel, setPanel] = useState<Shift | null>(null);
  const [filters, setFilters] = useState<PastFilters>(NO_PAST_FILTERS);
  const [text, setText] = useState("");
  // La ricerca parte dopo una pausa: senza, ogni lettera sarebbe una query e
  // una chiave di cache nuova. L'effetto dipende **solo** dal testo e scrive con
  // un aggiornamento funzionale — con `filters` fra le dipendenze, ogni pagina
  // caricata dallo scroll infinito farebbe ripartire l'attesa.
  useEffect(() => {
    const t = setTimeout(
      () => setFilters((f) => (f.q === text ? f : { ...f, q: text })),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [text]);
  const filtered = hasPastFilters(filters);
  // Il conteggio segue i filtri: è il totale della ricerca, non dello storico.
  const count = useOwnerPastShiftsCount(filters).data ?? 0;
  const { data, isPending, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useOwnerPastShifts(filters);

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Storico" />
        <NoVenues detail="I turni svolti compariranno qui." />
      </>
    );
  }

  const shifts = data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <>
      {/* Titolo e filtri restano fermi mentre la tabella scorre: con lo scroll
          infinito i comandi finirebbero a centinaia di righe di distanza. */}
      <StickyHeader>
        <PageHeader
          title="Storico"
          subtitle={
            filtered ? `${count} turni trovati` : `${count} turni svolti`
          }
        />

        {/* Sopra lo stato di caricamento: chi ha appena cambiato un filtro deve
            continuare a vedere i comandi mentre la query riparte. */}
        <PastShiftsFilters
          value={filters}
          onChange={setFilters}
          text={text}
          onTextChange={setText}
        />
      </StickyHeader>

      {isPending ? (
        <Spinner />
      ) : isError ? (
        <QueryError error={error} />
      ) : shifts.length === 0 ? (
        <Placeholder
          title={filtered ? "Nessun turno trovato" : "Nessun turno passato"}
          detail={
            filtered
              ? "Prova ad allargare il periodo o ad azzerare i filtri."
              : "Qui finiscono i turni una volta conclusi."
          }
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
                  {showHours ? (
                    <th className="px-5 py-3 font-semibold">Ore</th>
                  ) : null}
                  <th className="px-5 py-3 font-semibold">Stato</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => {
                  const counts = shiftCounts(s);
                  const hoursVisible = showHours && can(s.venue_id, "can_view_hours");
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
                    {showHours ? (
                      <td className="px-5 py-2.5">
                        {hoursVisible ? (
                          <HoursDeviations shift={s} />
                        ) : (
                          <span className="text-t4">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-5 py-2.5">
                      <ShiftStatus shift={s} withClock={hoursVisible} />
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

/** Oltre questo numero di nomi la cella dice «e altri N». */
const MAX_DEVIATION_NAMES = 2;

/**
 * Le ore del turno dette per persona: «In orario», oppure solo chi si è
 * discostato («Andrea +1 h»). Mai una somma: nasconderebbe di chi è l'ora in
 * più, e due scostamenti opposti si annullerebbero. Quelli ancora solo timbrati
 * restano in colore d'avviso, perché non sono ancora ore lavorate.
 */
function HoursDeviations({ shift }: { shift: ShiftWithAssignees }) {
  if (shift.status === "cancelled") return <span className="text-t4">—</span>;
  const { measured, deviations } = shiftDeviations(shift);
  if (measured === 0) return <span className="text-t4">—</span>;
  if (deviations.length === 0) return <span className="text-t3">In orario</span>;
  const shown = deviations.slice(0, MAX_DEVIATION_NAMES);
  const others = deviations.length - shown.length;
  return (
    <span className="text-t2">
      {shown.map((d, i) => (
        <span key={`${d.name}:${i}`}>
          {i > 0 ? ", " : ""}
          {d.name}{" "}
          <span
            title={d.proposed ? "Ore timbrate, ancora da approvare" : "Ore approvate"}
            className={
              d.proposed ? "font-mono text-warning" : "font-mono text-t1"
            }
          >
            {formatHoursVariance(d.delta)}
          </span>
        </span>
      ))}
      {others > 0 ? ` e altri ${others}` : ""}
    </span>
  );
}

/**
 * «Concluso» solo se non resta niente da fare: una timbratura aperta o da
 * approvare lo dice qui, perché il banner del Planning copre solo il periodo
 * visibile e passata la settimana nessun'altra vista la mostrerebbe.
 */
function ShiftStatus({
  shift,
  withClock,
}: {
  shift: ShiftWithAssignees;
  withClock: boolean;
}) {
  if (shift.status === "cancelled") return <Pill tone="error">Annullato</Pill>;
  const kinds = withClock
    ? clockAttentionForShift(shift).map((item) => item.kind)
    : [];
  if (kinds.includes("missing_out")) {
    return <Pill tone="warning">Uscita mancante</Pill>;
  }
  if (kinds.includes("to_review")) {
    return <Pill tone="warning">Da approvare</Pill>;
  }
  return <Pill tone="neutral">Concluso</Pill>;
}
