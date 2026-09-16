import { shiftCounts } from "@/features/assignments/coverage";
import { useOwnerTodayAssignments } from "@/features/assignments/hooks";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import type { Shift } from "@/features/shifts/api";
import {
  computeHomeStats,
  periodLabel,
  periodRange,
  STATS_PERIODS,
  type StatsPeriod,
} from "@/features/shifts/homeStats";
import {
  useOwnerShifts,
  useOwnerShiftsRange,
} from "@/features/shifts/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { cn } from "@/lib/cn";
import {
  formatDate,
  formatHours,
  formatShiftRange,
  formatTime,
  toDateString,
} from "@/lib/format";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AbsencesToHandle } from "../absences/AbsencesToHandle";
import { ShiftPanel } from "../shifts/ShiftPanel";
import { Card, PageHeader, Pill, Placeholder } from "../ui/primitives";
import { NoVenues } from "../venues/NoVenues";

type Worker = {
  key: string;
  name: string;
  role: string | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  /** Giorno del turno: serve a ordinare, e a segnalare chi è qui da ieri sera. */
  date: string;
  start: string;
  end: string;
  /** Dove lavora oggi. `null` con una sede sola. */
  venue: string | null;
};

/**
 * Vista d'insieme della sede. Le definizioni dei KPI sono le stesse della home
 * dell'app — se divergessero, gli stessi numeri direbbero cose diverse sui due
 * schermi.
 */
export function HomePage() {
  const { venues, isMultiVenue, canAny } = useOwnerVenues();
  /** Il nome della sede, o niente se il titolare ne ha una sola. */
  const venueName = useCallback(
    (venueId: string | undefined) => {
      if (!isMultiVenue || !venueId) return null;
      return venues.find((v) => v.id === venueId)?.name ?? null;
    },
    [venues, isMultiVenue],
  );
  const navigate = useNavigate();
  // Il turno si apre nel pannello qui sopra: restare sulla home è meno
  // spaesante che finire sul Planning, che si riposiziona da solo.
  const [panel, setPanel] = useState<Shift | null>(null);

  const [period, setPeriod] = useState<StatsPeriod>("week");
  // Lo stesso intervallo che apre il Planning, quindi la stessa entry di cache:
  // passare da una pagina all'altra non rifà la query.
  const { from, to } = useMemo(() => periodRange(period), [period]);
  const periodQuery = useOwnerShiftsRange(from, to);
  // Memo su `periodQuery.data` e non su un `?? []`: React Query tiene il
  // riferimento stabile finché il dato non cambia davvero, mentre un array nuovo
  // a ogni render ricalcolerebbe sempre.
  const stats = useMemo(
    () => computeHomeStats(periodQuery.data ?? []),
    [periodQuery.data],
  );
  // Cambiare periodo cambia la chiave di cache: senza questo i quattro numeri
  // cadrebbero a zero per un istante prima di riempirsi, e uno zero è una
  // risposta — non un'attesa. Vale anche per l'errore: meglio un trattino che
  // "0 turni scoperti" quando la query non è mai tornata.
  const statsReady = periodQuery.isSuccess;

  // `getOwnerShifts` è la lista dei prossimi turni **senza** limite superiore, e
  // resta tale: "Prossimi turni" deve mostrare cosa viene dopo anche di domenica
  // sera, quando il periodo scelto è ormai finito.
  const shifts = useOwnerShifts().data ?? [];
  const todayAssignments = useOwnerTodayAssignments().data ?? [];

  // Gli annullati non hanno posti da coprire: fuori anche dall'elenco.
  const activeUpcoming = shifts.filter((s) => s.status !== "cancelled");

  // "Chi lavora oggi": lo staff assegnato ai turni di oggi. Comprende chi è in
  // sala adesso su un turno cominciato ieri sera, quindi si ordina per giorno
  // **e** ora: il solo orario metterebbe un turno delle 22:00 di ieri dopo il
  // pranzo.
  const workers = useMemo<Worker[]>(
    () =>
      todayAssignments
        .map((a) => ({
          key: `asg-${a.id}`,
          name: a.staff_member?.display_name ?? "Staff",
          role: a.role?.name ?? null,
          ratingAvg: a.staff_member?.waiter?.waiter_profile?.rating_avg ?? null,
          ratingCount:
            a.staff_member?.waiter?.waiter_profile?.rating_count ?? null,
          date: a.shift?.date ?? "",
          start: a.shift?.start_time ?? "",
          end: a.shift?.end_time ?? "",
          venue: venueName(a.shift?.venue_id),
        }))
        .sort((a, b) =>
          `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
        ),
    [todayAssignments, venueName],
  );

  const nextShifts = activeUpcoming.slice(0, 5);

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Home" subtitle="Come sta andando la tua azienda" />
        <NoVenues />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={isMultiVenue ? "Home" : venues[0].name}
        subtitle={
          isMultiVenue
            ? `Come stanno andando le tue ${venues.length} sedi`
            : "Come sta andando la sede"
        }
      />

      {/* Il periodo sta **sopra i numeri che qualifica**: senza, "31 turni" non
          dice su quanto tempo, e la prima domanda di chi guarda è "in base a
          cosa?". */}
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-t3">
          {periodLabel(period)}
        </p>
        <div className="flex overflow-hidden rounded-xl border border-border-2 print:hidden">
          {STATS_PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "focus-gold px-3 py-1.5 text-xs font-semibold transition",
                period === p.value
                  ? "bg-gold text-gold-ink"
                  : "bg-bg-2 text-t2 hover:bg-bg-3",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-3">
        <Stat
          loading={!statsReady}
          value={stats.total}
          label="turni"
          hint={`${stats.done} svolti · ${stats.upcoming} da fare`}
        />
        <Stat
          loading={!statsReady}
          value={stats.shortCount}
          label="turni scoperti"
          hint="solo quelli ancora da fare"
          tone={stats.shortCount > 0 ? "warning" : "normal"}
          onClick={() => navigate("/planning")}
        />
        <Stat
          loading={!statsReady}
          value={stats.missingSlots}
          label="posti da coprire"
          hint="persone che mancano"
          tone={stats.missingSlots > 0 ? "warning" : "normal"}
          onClick={() => navigate("/planning")}
        />
        <Stat
          loading={!statsReady}
          value={formatHours(stats.hours)}
          label="ore pianificate"
        />
      </div>

      <AbsencesToHandle enabled={canAny("can_manage_staff")} />

      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
            Chi lavora oggi {workers.length > 0 ? `· ${workers.length}` : ""}
          </h2>
          {workers.length === 0 ? (
            <Placeholder
              title="Oggi non lavora nessuno"
              detail="Nessun turno assegnato per la giornata di oggi."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {workers.map((w) => (
                <Card
                  key={w.key}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-t1">
                      {w.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-t4">
                      {[w.role ?? "Ruolo non indicato", w.venue]
                        .filter(Boolean)
                        .join(" · ")}
                      {REVIEWS_ENABLED && w.ratingCount ? (
                        <span className="ml-2 text-gold">
                          ★ {w.ratingAvg?.toFixed(1)}
                        </span>
                      ) : null}
                      {/* Turno di ieri sera ancora in corso: senza questo
                          sembrerebbe uno che attacca oggi a quell'ora. */}
                      {w.date && w.date !== toDateString(new Date()) ? (
                        <span className="ml-2 text-warning">da ieri</span>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-t2">
                    {w.start && w.end
                      ? formatShiftRange(w.start, w.end)
                      : w.start
                        ? formatTime(w.start)
                        : "—"}
                  </span>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
            Prossimi turni
          </h2>
          {nextShifts.length === 0 ? (
            <Placeholder
              title="Nessun turno in programma"
              detail="Crea il primo turno dal Planning."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {nextShifts.map((s) => {
                const { filled: covered, total, short } = shiftCounts(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => setPanel(s)}
                    className="focus-gold rounded-2xl border border-border-2 bg-bg-card p-3 text-left transition hover:border-border-gold hover:bg-bg-1"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {/* Il pallino della sede: in un elenco che mescola tre
                            sedi, due turni identici vanno distinti. */}
                        {isMultiVenue ? (
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: venueAccent(
                                venues.findIndex((v) => v.id === s.venue_id),
                              ),
                            }}
                          />
                        ) : null}
                        <span className="truncate text-sm font-semibold text-t1">
                          {s.title}
                        </span>
                      </span>
                      <Pill tone={short ? "warning" : "success"}>
                        {covered}/{total}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs text-t3">
                      {formatDate(s.date)} ·{" "}
                      <span className="font-mono">
                        {formatShiftRange(s.start_time, s.end_time)}
                      </span>
                      {venueName(s.venue_id) ? (
                        <span className="ml-2 text-t4">
                          {venueName(s.venue_id)}
                        </span>
                      ) : null}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

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

function Stat({
  value,
  label,
  hint,
  tone = "normal",
  loading = false,
  onClick,
}: {
  value: string | number;
  label: string;
  /** La riga sotto l'etichetta: cosa il numero conta, quando non è ovvio. */
  hint?: string;
  tone?: "normal" | "gold" | "warning";
  /** Dato non ancora disponibile: un trattino, non uno zero. */
  loading?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border-2 bg-bg-card p-4 text-left",
        onClick && "focus-gold transition hover:border-border-gold",
      )}
    >
      <p
        className={cn(
          "font-mono text-3xl",
          loading && "text-t4",
          !loading && tone === "gold" && "text-gold",
          !loading && tone === "warning" && "text-warning",
          !loading && tone === "normal" && "text-t1",
        )}
      >
        {loading ? "—" : value}
      </p>
      <p className="mt-1 text-xs text-t3">{label}</p>
      {hint && !loading ? (
        <p className="mt-0.5 text-[11px] text-t4">{hint}</p>
      ) : null}
    </Tag>
  );
}
