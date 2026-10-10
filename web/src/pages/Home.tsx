import { PersonAvatar } from "../ui/PersonAvatar";
import { shiftCounts } from "@/features/assignments/coverage";
import { useOwnerTodayAssignments } from "@/features/assignments/hooks";
import { useStartConversation } from "@/features/chat/hooks";
import type { OpenUnplannedClock } from "@/features/clock/api";
import { useOpenUnplannedClocks } from "@/features/clock/hooks";
import {
  liveClockStatusIn,
  liveClockSummary,
  type LiveClockStatus,
} from "@/features/clock/live";
import { useSelfStaff } from "@/features/staff/self";
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
import { userErrorMessage } from "@/lib/errors";
import { useNow } from "@/lib/useNow";
import {
  formatDate,
  formatShiftRange,
  formatTime,
  toDateString,
} from "@/lib/format";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AbsencesToHandle } from "../absences/AbsencesToHandle";
import { LiveClockLine } from "../shifts/LiveClockLine";
import { ShiftPanel } from "../shifts/ShiftPanel";
import { UnplannedClockDialog } from "../shifts/UnplannedClockDialog";
import {
  Button,
  Card,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
} from "../ui/primitives";
import { ListSkeleton, LoadingRegion, Skeleton } from "../ui/Skeleton";
import { useToast } from "../ui/Toast";
import { NoVenues } from "../venues/NoVenues";

type Worker = {
  key: string;
  name: string;
  personId: string | null;
  role: string | null;
  /** Giorno del turno: serve a ordinare, e a segnalare chi è qui da ieri sera. */
  date: string;
  start: string;
  end: string;
  /** Dove lavora oggi. `null` con una sede sola. */
  venue: string | null;
  /** La timbratura dal vivo; `null` se non timbra o non la si può vedere. */
  live: LiveClockStatus | null;
  /** La persona, per scriverle; `null` sulla propria riga. */
  memberId: string | null;
  /** In servizio senza un turno: niente orario pianificato da mostrare. */
  unplanned?: OpenUnplannedClock;
};

/**
 * Vista d'insieme della sede. Le definizioni dei KPI sono le stesse della home
 * dell'app — se divergessero, gli stessi numeri direbbero cose diverse sui due
 * schermi.
 */
export function HomePage() {
  const { venues, isMultiVenue, can, canAny, workspaceId } = useOwnerVenues();
  const self = useSelfStaff();
  // L'etichetta «In ritardo» scatta a un'ora precisa: basta un tick al minuto,
  // le timbrature arrivano già col realtime.
  const now = useNow();
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
  const unplannedQuery = useOpenUnplannedClocks(workspaceId);
  const unplannedData = unplannedQuery.data;
  const [managing, setManaging] = useState<OpenUnplannedClock | null>(null);

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
  // Cambiare periodo cambia la chiave di cache: senza questo i due numeri
  // cadrebbero a zero per un istante prima di riempirsi, e uno zero è una
  // risposta — non un'attesa. Vale anche per l'errore: meglio un trattino che
  // "0 turni scoperti" quando la query non è mai tornata.
  const statsReady = periodQuery.isSuccess;

  // `getOwnerShifts` è la lista dei prossimi turni **senza** limite superiore, e
  // resta tale: "Prossimi turni" deve mostrare cosa viene dopo anche di domenica
  // sera, quando il periodo scelto è ormai finito.
  const shiftsQuery = useOwnerShifts();
  const shifts = shiftsQuery.data ?? [];
  const todayQuery = useOwnerTodayAssignments();
  const todayData = todayQuery.data;
  const todayAssignments = useMemo(() => todayData ?? [], [todayData]);

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
          personId: a.staff_member?.person_id ?? null,
          role: a.role?.name ?? null,
          date: a.shift?.date ?? "",
          start: a.shift?.start_time ?? "",
          end: a.shift?.end_time ?? "",
          venue: venueName(a.shift?.venue_id),
          // Le timbrature le legge chi ha Turni o Ore (la RLS): per gli altri
          // non arrivano, e l'assenza sembrerebbe un ritardo.
          live:
            a.shift &&
            (can(a.shift.venue_id, "can_manage_shifts") ||
              can(a.shift.venue_id, "can_view_hours"))
              ? liveClockStatusIn(venues, a.shift, a, now)
              : null,
          memberId: self.isSelf(a.staff_member?.waiter_id)
            ? null
            : (a.staff_member?.person_id ?? null),
        }))
        // Chi è in ritardo in cima, come nelle viste «chi sta lavorando»: è
        // l'unica riga che chiede di fare qualcosa. Poi per giorno e ora.
        .sort(
          (a, b) =>
            Number(b.live?.kind === "late") - Number(a.live?.kind === "late") ||
            `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
        ),
    [todayAssignments, venueName, venues, can, self, now],
  );
  // Chi timbra senza turno non è in nessuna assegnazione di oggi: va in cima,
  // perché è anche l'unica riga che chi ha «Ore» può dover chiudere.
  const allWorkers = useMemo<Worker[]>(
    () => [
      ...(unplannedData ?? []).map((c) => ({
        key: `clk-${c.recordId}`,
        name: c.memberName,
        personId: c.memberId,
        role: c.roleName,
        date: "",
        start: "",
        end: "",
        venue: venueName(c.venueId),
        live: { kind: "in", since: c.clockInAt } as LiveClockStatus,
        memberId: c.memberId,
        unplanned: c,
      })),
      ...workers,
    ],
    [unplannedData, workers, venueName],
  );
  const liveSummary = liveClockSummary(allWorkers.map((w) => w.live));

  const nextShifts = activeUpcoming.slice(0, 5);

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <NoVenues />
      </>
    );
  }

  return (
    <>
      <PageHeader title={isMultiVenue ? "Home" : venues[0].name} />

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

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Stat
          loading={periodQuery.isPending}
          value={statsReady ? stats.shortCount : "—"}
          label="turni scoperti"
          hint="solo quelli ancora da fare"
          tone={stats.shortCount > 0 ? "warning" : "normal"}
          onClick={() => navigate("/planning")}
        />
        <Stat
          loading={periodQuery.isPending}
          value={statsReady ? stats.missingSlots : "—"}
          label="posti da coprire"
          hint="persone che mancano"
          tone={stats.missingSlots > 0 ? "warning" : "normal"}
          onClick={() => navigate("/planning")}
        />
      </div>

      {periodQuery.isError ? (
        <div className="mb-6"><QueryError error={periodQuery.error} /></div>
      ) : null}

      <AbsencesToHandle enabled={canAny("can_manage_staff")} />

      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
            Chi lavora oggi {allWorkers.length > 0 ? `· ${allWorkers.length}` : ""}
            {liveSummary ? (
              <span className="normal-case tracking-normal text-t2">
                {" "}
                · {liveSummary}
              </span>
            ) : null}
          </h2>
          {todayQuery.isPending ? (
            <ListSkeleton avatar label="Caricamento di chi lavora oggi…" />
          ) : todayQuery.isError ? (
            <QueryError error={todayQuery.error} />
          ) : allWorkers.length === 0 ? (
            <Placeholder
              title="Oggi non lavora nessuno"
              detail="Nessun turno assegnato per la giornata di oggi."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {allWorkers.map((w) => (
                <Card
                  key={w.key}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <PersonAvatar personId={w.personId} name={w.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-t1">
                      {w.name}
                      {w.unplanned ? (
                        <span className="ml-2 align-middle">
                          <Pill tone="warning">Fuori turno</Pill>
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-t4">
                      {[w.role ?? "Ruolo non indicato", w.venue]
                        .filter(Boolean)
                        .join(" · ")}
                      {/* Turno di ieri sera ancora in corso: senza questo
                          sembrerebbe uno che attacca oggi a quell'ora. */}
                      {w.date && w.date !== toDateString(new Date()) ? (
                        <span className="ml-2 text-warning">da ieri</span>
                      ) : null}
                    </p>
                    {w.live ? <LiveClockLine status={w.live} /> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {w.live?.kind === "late" && w.memberId ? (
                      <WriteButton memberId={w.memberId} />
                    ) : null}
                    {w.unplanned?.canManage ? (
                      <Button onClick={() => setManaging(w.unplanned ?? null)}>
                        Gestisci
                      </Button>
                    ) : null}
                    <span className="font-mono text-xs text-t2">
                      {w.start && w.end
                        ? formatShiftRange(w.start, w.end)
                        : w.start
                          ? formatTime(w.start)
                          : "—"}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-t3">
            Prossimi turni
          </h2>
          {shiftsQuery.isPending ? (
            <ListSkeleton rows={5} label="Caricamento prossimi turni…" />
          ) : shiftsQuery.isError ? (
            <QueryError error={shiftsQuery.error} />
          ) : nextShifts.length === 0 ? (
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

      {managing ? (
        <UnplannedClockDialog
          clock={managing}
          onClose={() => setManaging(null)}
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
  /** Lo skeleton occupa lo stesso spazio del numero. */
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
      {loading ? (
        <LoadingRegion label={`Caricamento ${label}…`}>
          <Skeleton className="h-9 w-12" />
        </LoadingRegion>
      ) : (
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
      )}
      <p className="mt-1 text-xs text-t3">{label}</p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-t4">{hint}</p>
      ) : null}
    </Tag>
  );
}

/** Chi è in ritardo si sente con un messaggio: la chat c'è già. */
function WriteButton({ memberId }: { memberId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const startConversation = useStartConversation();
  return (
    <button
      type="button"
      disabled={startConversation.isPending}
      onClick={() =>
        startConversation.mutate(
          { memberId },
          {
            onSuccess: (conv) => navigate(`/chat/${conv.id}`),
            onError: (e) => toast.show(userErrorMessage(e), "error"),
          },
        )
      }
      className="focus-gold rounded-lg border border-warning/50 px-2.5 py-1 text-xs font-semibold text-warning transition hover:bg-warning/10 disabled:opacity-50"
    >
      {startConversation.isPending ? "Apertura…" : "Scrivi"}
    </button>
  );
}
