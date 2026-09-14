import { shiftCounts } from "@/features/assignments/coverage";
import { useOwnerTodayAssignments } from "@/features/assignments/hooks";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import type { Shift } from "@/features/shifts/api";
import {
  useOwnerPastShiftsCount,
  useOwnerShifts,
} from "@/features/shifts/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { cn } from "@/lib/cn";
import {
  formatDate,
  formatShiftRange,
  formatTime,
  toDateString,
} from "@/lib/format";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
 * Vista d'insieme del locale. Le definizioni dei KPI sono le stesse della home
 * dell'app — se divergessero, gli stessi numeri direbbero cose diverse sui due
 * schermi.
 */
export function HomePage() {
  const { venues, isMultiVenue } = useOwnerVenues();
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

  const shifts = useOwnerShifts().data ?? [];
  const pastCount = useOwnerPastShiftsCount().data ?? 0;
  const todayAssignments = useOwnerTodayAssignments().data ?? [];

  // `getOwnerShifts` torna già solo i turni non conclusi (turni notturni inclusi):
  // qui non serve più rifiltrare per data, che tagliava fuori proprio quelli.
  const upcoming = shifts;
  // Gli annullati non hanno posti da coprire: esclusi dai KPI.
  const activeUpcoming = upcoming.filter((s) => s.status !== "cancelled");
  const counts = activeUpcoming.map((s) => shiftCounts(s));
  const filled = counts.reduce((n, c) => n + c.filled, 0);
  const totalPos = counts.reduce((n, c) => n + c.total, 0);
  // L'unico numero su cui c'è da agire: turni che partono senza abbastanza
  // gente. Esce da `counts`, già calcolato: nessuna query in più.
  const shortCount = counts.filter((c) => c.short).length;

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
            ? `Come stanno andando i tuoi ${venues.length} locali`
            : "Come sta andando il locale"
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-3">
        <Stat value={activeUpcoming.length} label="turni in programma" />
        <Stat
          value={`${filled}/${totalPos}`}
          label="turni coperti"
          tone={totalPos > 0 && filled < totalPos ? "warning" : "normal"}
        />
        <Stat
          value={shortCount}
          label="turni scoperti"
          tone={shortCount > 0 ? "warning" : "normal"}
          onClick={() => navigate("/planning")}
        />
        <Stat value={pastCount} label="turni svolti" />
      </div>

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
                            locali, due turni identici vanno distinti. */}
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
  tone = "normal",
  onClick,
}: {
  value: string | number;
  label: string;
  tone?: "normal" | "gold" | "warning";
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
          tone === "gold" && "text-gold",
          tone === "warning" && "text-warning",
          tone === "normal" && "text-t1",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-t3">{label}</p>
    </Tag>
  );
}
