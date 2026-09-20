import { useCallback, useEffect, useMemo, useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { useSearchParams } from "react-router-dom";
import {
  useMoveShiftToDate,
  useShift,
  useOwnerShiftsRange,
} from "@/features/shifts/hooks";
import { useReassignShiftAssignment } from "@/features/assignments/hooks";
import type { AbsenceAvailability } from "@/features/absences/api";
import { absenceForShift } from "@/features/absences/conflicts";
import { useAbsenceAvailability } from "@/features/absences/hooks";
import { absenceWarning } from "@/features/absences/labels";
import {
  reassignNotifyPlan,
  shiftNotifyRecipients,
  type ReassignNotifyPlan,
  type ShiftNotifyRecipients,
} from "@/features/shifts/notify";
import {
  formatDate,
  formatShiftRange,
  formatTime,
  isOvernightShift,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  shiftCoverage,
  shiftCounts,
  shiftTone,
} from "@/features/assignments/coverage";
import type { Shift, ShiftWithAssignees } from "@/features/shifts/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { NoVenues } from "../venues/NoVenues";
import {
  addDays,
  addMonths,
  dayLabel,
  isSameMonth,
  isToday,
  monthGridDays,
  monthTitle,
  startOfMonth,
  startOfWeek,
  weekDays,
  weekLabel,
  WEEKDAY_NAMES,
} from "../lib/week";
import {
  Button,
  PageHeader,
  Pill,
  QueryError,
  Select,
  Spinner,
} from "../ui/primitives";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { ShiftPanel } from "../shifts/ShiftPanel";
import { PeopleWeek } from "../shifts/PeopleWeek";
import { DuplicatePeriodDialog } from "../shifts/DuplicatePeriodDialog";
import { CoverageLegend, TONE_BORDER } from "../shifts/CoverageLegend";
import {
  dropClass,
  ShiftDragProvider,
  useShiftDrag,
  type MoveDragPayload,
  type ReassignDragPayload,
  type ReassignTarget,
} from "../shifts/dragContext";

const VIEWS = ["settimana", "mese", "persone"] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY = "topwaitr.planning.view";
const VENUE_KEY = "topwaitr.planning.venue";

function storedView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.find((v) => v === saved) ?? "settimana";
  } catch {
    // Private browsing / cookie bloccati: si riparte dal default.
    return "settimana";
  }
}

/** Il filtro per sede scelto l'ultima volta. `null` = tutte. */
function storedVenue(): string | null {
  try {
    return localStorage.getItem(VENUE_KEY);
  } catch {
    return null;
  }
}

/**
 * Planning. Tre viste sullo stesso dato, tutte da `useOwnerShiftsRange` — che
 * porta i turni di **tutte** le sedi del titolare: il planning non è più di una
 * sede, e ogni turno dice a quale appartiene.
 *
 * - **settimana** per lavorare (celle alte, si legge tutto);
 * - **mese** per vedere la forma del periodo e trovare i giorni scoperti;
 * - **persone** per la domanda che le altre due non pongono, «chi lavora
 *   quanto»: righe = organico, colonne = giorni, ore programmate a destra.
 *
 * Settimana e persone guardano lo stesso intervallo: cambia solo il pivot.
 */
export function PlanningPage() {
  const { venues, venueIds, isMultiVenue, canAny } = useOwnerVenues();
  // Chi gestisce può essere in turno: il trigger non avvisa chi sta spostando,
  // e la finestra di conferma non deve promettere un avviso in più.
  const { session } = useAuth();
  // Duplicare un periodo crea turni: stesso permesso che serve a crearne uno
  // (`ShiftPanel` filtra già le sedi con `venuesWith("can_manage_shifts")`).
  const canCreateShift = canAny("can_manage_shifts");
  /** La sede di un turno: nome e colore. `undefined` con una sede sola. */
  const venueOf = useCallback(
    (venueId: string) => {
      if (!isMultiVenue) return undefined;
      const i = venues.findIndex((v) => v.id === venueId);
      return i < 0
        ? undefined
        : { name: venues[i].name, accent: venueAccent(i) };
    },
    [venues, isMultiVenue]
  );
  const [view, setView] = useState<View>(storedView);
  const [venueFilter, setVenueFilter] = useState<string | null>(storedVenue);
  // Il filtro salvato può puntare a una sede chiusa, o a quella di un altro
  // account sullo stesso browser: si valida contro le sedi vere, altrimenti il
  // planning resterebbe vuoto senza dire perché.
  const activeVenueId =
    venueFilter && venues.some((v) => v.id === venueFilter) ? venueFilter : null;
  const activeVenueName = venues.find((v) => v.id === activeVenueId)?.name;
  /** Le sedi da interrogare: una sola se il filtro è attivo, sennò tutte. */
  const scopedIds = useMemo(
    () => (activeVenueId ? [activeVenueId] : venueIds),
    [activeVenueId, venueIds]
  );
  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [panel, setPanel] = useState<{
    date: string;
    shift?: Shift;
    /** Preselezione in creazione (id di persona), dalla vista per persona. */
    personIds?: string[];
  } | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const [params, setParams] = useSearchParams();
  const deepLinkId = params.get("shift");

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Preferenza non memorizzabile: pazienza, la vista resta per la sessione.
    }
  }, [view]);

  useEffect(() => {
    try {
      if (venueFilter) localStorage.setItem(VENUE_KEY, venueFilter);
      else localStorage.removeItem(VENUE_KEY);
    } catch {
      // Preferenza non memorizzabile: il filtro resta per la sessione.
    }
  }, [venueFilter]);

  const isWeekly = view !== "mese";
  const days = useMemo(
    () => (isWeekly ? weekDays(monday) : monthGridDays(month)),
    [isWeekly, monday, month]
  );

  // Il filtro per sede è **del server**: cambia l'insieme di `venue_id`
  // interrogato, non nasconde righe già scaricate. Con dieci sedi e un mese
  // aperto la differenza è tutto il payload.
  const { data, isPending, isError, error } = useOwnerShiftsRange(
    days[0],
    days[days.length - 1],
    scopedIds
  );

  const byDay = useMemo(() => {
    const map = new Map<string, ShiftWithAssignees[]>();
    for (const day of days) map.set(day, []);
    for (const shift of data ?? []) map.get(shift.date)?.push(shift);
    return map;
  }, [data, days]);

  const byId = useMemo(
    () => new Map((data ?? []).map((s) => [s.id, s])),
    [data]
  );

  // Quante persone mancano sul periodo che si ha davanti. Era il sottotitolo di
  // una pagina "Copertura" a parte, che però ripeteva questa stessa griglia: il
  // numero vale di più qui, sopra i turni a cui si riferisce. I dati sono già
  // caricati — `getOwnerShiftsRange` porta con sé fabbisogni e assegnazioni.
  const missing = useMemo(
    () =>
      (data ?? [])
        .filter((s) => s.status !== "cancelled")
        .reduce((sum, s) => {
          const { filled, total } = shiftCounts(s);
          return sum + Math.max(0, total - filled);
        }, 0),
    [data]
  );

  /**
   * Cosa si duplica. Sulla vista mese **non** è tutto `data`: la griglia mensile
   * è fatta di settimane intere, quindi contiene la coda del mese prima e la
   * testa di quello dopo — copiarle vorrebbe dire duplicare turni che l'utente
   * vede in grigio e non considera suoi.
   */
  const duplicable = useMemo(
    () =>
      isWeekly
        ? (data ?? [])
        : (data ?? []).filter((s) => isSameMonth(s.date, month)),
    [data, isWeekly, month]
  );

  // Chi non c'è nel periodo visibile, senza il perché. Serve alla vista per
  // persona e all'avviso quando si passa un turno a qualcuno assente.
  const absences =
    useAbsenceAvailability(days[0], days[days.length - 1]).data ?? [];

  const toast = useToast();
  const move = useMoveShiftToDate();
  const reassign = useReassignShiftAssignment();
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const busy = move.isPending || reassign.isPending;

  // Un solo punto di esecuzione per ciascuna azione, condiviso fra il percorso
  // diretto e quello che passa dalla conferma: se fossero due, prima o poi
  // direbbero cose diverse.
  function runMove(payload: MoveDragPayload, toDate: string) {
    setPendingDrop(null);
    move.mutate(
      { shiftId: payload.shiftId, date: toDate },
      {
        onSuccess: () => toast.show(`Turno spostato a ${formatDate(toDate)}`),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  function requestMove(payload: MoveDragPayload, toDate: string) {
    if (busy) return;
    const notify = shiftNotifyRecipients(
      byId.get(payload.shiftId),
      session?.user.id
    );
    // Nessuno da avvisare: non c'è niente da confermare.
    if (notify.total === 0) {
      runMove(payload, toDate);
      return;
    }
    setPendingDrop({ kind: "move", payload, toDate, notify });
  }

  function runReassign(payload: ReassignDragPayload, to: ReassignTarget) {
    setPendingDrop(null);
    reassign.mutate(
      {
        assignmentId: payload.assignmentId,
        shiftId: payload.shiftId,
        toStaffMember: {
          id: to.id,
          person_id: to.person_id,
          display_name: to.display_name,
          // Le sue mansioni **in quella sede**: la patch ottimistica riproduce
          // con queste la regola che il server applica per il ruolo di chi entra.
          roles: to.roles,
        },
      },
      {
        onSuccess: () => toast.show(`Turno passato a ${to.display_name}`),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  function requestReassign(payload: ReassignDragPayload, to: ReassignTarget) {
    if (busy) return;
    // `unique (shift_id, venue_member_id)`: è l'unico rifiuto che vale la pena
    // spiegare, perché guardando la griglia non si deduce.
    if (payload.busyStaffIds.includes(to.id)) {
      toast.show(`${to.display_name} è già su questo turno.`, "error");
      return;
    }
    const shift = byId.get(payload.shiftId);
    const from = shift?.shift_assignments.find(
      (a) => a.id === payload.assignmentId
    );
    const plan = reassignNotifyPlan({
      shiftDate: payload.date,
      shiftCancelled: shift?.status === "cancelled",
      from: {
        status: from?.status ?? "assigned",
        waiterId: from?.staff_member?.waiter_id ?? null,
      },
      toWaiterId: to.waiter_id,
    });
    // Chi riceve il turno è assente: si chiede conferma anche se nessuno
    // verrebbe avvisato. Avviso, non blocco.
    const absence = shift
      ? absenceForShift(
          shift,
          absences.filter((a) => a.member_id === to.person_id)
        )
      : null;
    if (!plan.notifiesFrom && !plan.notifiesTo && !absence) {
      runReassign(payload, to);
      return;
    }
    setPendingDrop({ kind: "reassign", payload, to, plan, absence });
  }

  function goToday() {
    setMonday(startOfWeek(new Date()));
    setMonth(startOfMonth(new Date()));
  }

  if (venues.length === 0) {
    return (
      <>
        <PageHeader title="Planning" />
        <NoVenues detail="Ti serve una sede prima di programmare i turni." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={
          <>
            {isWeekly ? weekLabel(monday) : monthTitle(month)}
            {/* Anche sul foglio: i comandi non si stampano, quindi senza questo
                un turnario filtrato sembrerebbe l'agenda di tutta l'azienda. */}
            {activeVenueName ? ` · ${activeVenueName}` : null}
            {missing > 0 ? (
              <span className="text-warning">
                {" · "}
                {missing === 1 ? "Manca 1 persona" : `Mancano ${missing} persone`}
                {isWeekly ? " questa settimana" : " questo mese"}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {/* Il filtro per sede ha senso solo se le sedi sono più d'una. */}
            {isMultiVenue ? (
              <Select
                aria-label="Filtra per sede"
                value={activeVenueId ?? ""}
                onChange={(e) => setVenueFilter(e.target.value || null)}
                className="mr-2 w-auto"
              >
                <option value="">Tutte le sedi</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {/* Si duplica il periodo che si ha davanti: la settimana sulle viste
                settimanali, il mese sulla vista mese. Il dialogo dice quanti
                turni e quante notifiche prima di procedere — che su un mese non
                è una formalità. */}
            {canCreateShift ? (
              <Button onClick={() => setDuplicating(true)}>
                {isWeekly ? "Duplica settimana" : "Duplica mese"}
              </Button>
            ) : null}
            {/* Il turnario finisce in bacheca: la stampa la fa il browser sulla
                vista che hai davanti, con i token ribaltati su bianco. */}
            <Button className="mr-2" onClick={() => window.print()}>
              Stampa
            </Button>
            <div className="mr-2 flex overflow-hidden rounded-xl border border-border-2">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "focus-gold px-3 py-2 text-sm font-semibold capitalize transition",
                    view === v
                      ? "bg-gold text-gold-ink"
                      : "bg-bg-2 text-t2 hover:bg-bg-3"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button
              onClick={() =>
                isWeekly
                  ? setMonday((m) => addDays(m, -7))
                  : setMonth((m) => addMonths(m, -1))
              }
            >
              ←
            </Button>
            <Button onClick={goToday}>Oggi</Button>
            <Button
              onClick={() =>
                isWeekly
                  ? setMonday((m) => addDays(m, 7))
                  : setMonth((m) => addMonths(m, 1))
              }
            >
              →
            </Button>
          </>
        }
      />

      {isError ? <QueryError error={error} /> : null}
      {isPending ? <Spinner /> : null}

      <p className="mb-3 text-xs text-t4 print:hidden">
        {view === "persone"
          ? "Trascina un turno sulla riga di un'altra persona per riassegnarlo."
          : "Trascina un turno su un altro giorno per spostarlo."}
      </p>

      <ShiftDragProvider>
        {view === "settimana" ? (
          <WeekGrid
            days={days}
            byDay={byDay}
            venueOf={venueOf}
            onCreate={(day) => setPanel({ date: day })}
            onOpen={(day, shift) => setPanel({ date: day, shift })}
            onMove={requestMove}
          />
        ) : view === "persone" ? (
          <PeopleWeek
            days={days}
            shifts={data ?? []}
            venueIds={scopedIds}
            absences={absences}
            onOpen={(shift) => setPanel({ date: shift.date, shift })}
            onCreate={(day, personId) =>
              setPanel({ date: day, personIds: [personId] })
            }
            onReassign={requestReassign}
          />
        ) : (
          <MonthGrid
            days={days}
            month={month}
            byDay={byDay}
            venueOf={venueOf}
            onCreate={(day) => setPanel({ date: day })}
            onOpen={(day, shift) => setPanel({ date: day, shift })}
            onMove={requestMove}
          />
        )}
      </ShiftDragProvider>

      {deepLinkId ? (
        <DeepLinkedShift
          id={deepLinkId}
          onResolved={(shift) => {
            const d = new Date(`${shift.date}T00:00:00`);
            setMonday(startOfWeek(d));
            setMonth(startOfMonth(d));
            setPanel({ date: shift.date, shift });
            setParams({}, { replace: true });
          }}
        />
      ) : null}

      {duplicating ? (
        <DuplicatePeriodDialog
          period={isWeekly ? "week" : "month"}
          anchor={isWeekly ? monday : month}
          shifts={duplicable}
          // Stesso perimetro della griglia che si sta guardando: si copia quel
          // che si vede, e il conteggio del periodo di destinazione deve contare
          // le stesse sedi, sennò avviserebbe per turni non copiabili.
          venueIds={scopedIds}
          onClose={() => setDuplicating(false)}
        />
      ) : null}

      {panel ? (
        <ShiftPanel
          date={panel.date}
          shift={panel.shift}
          initialPersonIds={panel.personIds}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {/* Spostare un turno è anche una notifica sul telefono di qualcuno: lo si
          dice prima, con i numeri veri, non dopo. */}
      {pendingDrop?.kind === "move" ? (
        <ConfirmDialog
          title="Sposta il turno"
          message={moveMessage(
            pendingDrop.payload,
            pendingDrop.toDate,
            pendingDrop.notify
          )}
          confirmLabel="Sposta e avvisa"
          pending={busy}
          onConfirm={() => runMove(pendingDrop.payload, pendingDrop.toDate)}
          onCancel={() => setPendingDrop(null)}
        />
      ) : null}

      {pendingDrop?.kind === "reassign" ? (
        <ConfirmDialog
          title="Cambia persona"
          message={[
            pendingDrop.absence
              ? absenceWarning(pendingDrop.to.display_name, pendingDrop.absence)
              : null,
            reassignMessage(
              pendingDrop.payload,
              pendingDrop.to,
              pendingDrop.plan
            ),
          ]
            .filter(Boolean)
            .join(" ")}
          confirmLabel={
            pendingDrop.plan.notifiesFrom || pendingDrop.plan.notifiesTo
              ? "Riassegna e avvisa"
              : "Riassegna comunque"
          }
          pending={busy}
          onConfirm={() => runReassign(pendingDrop.payload, pendingDrop.to)}
          onCancel={() => setPendingDrop(null)}
        />
      ) : null}
    </>
  );
}

/** Il drop in attesa di conferma: il carico va copiato qui, perché `dragend` lo
 *  azzera prima che l'utente decida. */
type PendingDrop =
  | {
      kind: "move";
      payload: MoveDragPayload;
      toDate: string;
      notify: ShiftNotifyRecipients;
    }
  | {
      kind: "reassign";
      payload: ReassignDragPayload;
      to: ReassignTarget;
      plan: ReassignNotifyPlan;
      /** Chi riceve il turno è assente quel giorno (o l'ha chiesto). */
      absence: AbsenceAvailability | null;
    };

/** "Anna", "Anna e Bruno", "Anna, Bruno e Carla". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function moveMessage(
  payload: MoveDragPayload,
  toDate: string,
  notify: ShiftNotifyRecipients
): string {
  const who =
    notify.total === 1
      ? "Una persona riceverà"
      : `${notify.total} persone riceveranno`;
  // I nomi solo quando sono pochi: oltre, un elenco lungo non aiuta a decidere.
  const names =
    notify.assignees.length > 0 && notify.assignees.length <= 4
      ? `: ${nameList(notify.assignees)}`
      : "";
  return `«${payload.title}» passa da ${formatDate(payload.sourceDate)} a ${formatDate(toDate)}. ${who} la notifica del cambio${names}.`;
}

const SKIP_REASON: Record<NonNullable<ReassignNotifyPlan["fromSkip"]>, string> =
  {
    declined: "aveva già rifiutato il turno",
    "no-account": "non ha un account collegato",
    past: "il turno è già passato",
    cancelled: "il turno è annullato",
  };

function reassignMessage(
  payload: ReassignDragPayload,
  to: ReassignTarget,
  plan: ReassignNotifyPlan
): string {
  const head = `«${payload.title}» del ${formatDate(payload.date)} passa da ${payload.fromStaffName} a ${to.display_name}.`;
  // Si arriva qui senza nessuno da avvisare solo per l'avviso di assenza.
  if (!plan.notifiesFrom && !plan.notifiesTo) return head;
  if (plan.notifiesFrom && plan.notifiesTo) {
    return `${head} ${payload.fromStaffName} riceverà «Turno revocato», ${to.display_name} «Nuovo turno assegnato».`;
  }
  if (plan.notifiesTo) {
    return `${head} ${to.display_name} riceverà «Nuovo turno assegnato». ${payload.fromStaffName} non riceverà la notifica: ${SKIP_REASON[plan.fromSkip ?? "no-account"]}.`;
  }
  return `${head} ${payload.fromStaffName} riceverà «Turno revocato». ${to.display_name} non ha un account collegato, quindi non riceverà nulla.`;
}

/**
 * La settimana da lavorare: sette colonne alte, una per giorno. Ogni colonna è
 * anche un bersaglio del trascinamento — gli eventi bollono, quindi un rilascio
 * sopra una card o sopra "+ Turno" lo raccoglie comunque la sezione.
 */
function WeekGrid({
  days,
  byDay,
  onCreate,
  onOpen,
  onMove,
  venueOf,
}: {
  days: string[];
  byDay: Map<string, ShiftWithAssignees[]>;
  onCreate: (day: string) => void;
  onOpen: (day: string, shift: ShiftWithAssignees) => void;
  onMove: (payload: MoveDragPayload, toDate: string) => void;
  /** La sede di un turno, per il bordo colorato. Vuoto con una sede sola. */
  venueOf: (venueId: string) => { name: string; accent: string } | undefined;
}) {
  const dnd = useShiftDrag();

  return (
    <div>
      <div className="grid grid-cols-7 gap-3">
        {days.map((day) => {
          const { name, num } = dayLabel(day);
          const shifts = byDay.get(day) ?? [];
          const { state, ...dropHandlers } = dnd.dropProps({
            key: `week:${day}`,
            accepts: (d) => d.mode === "move" && d.sourceDate !== day,
            onDrop: (d) => {
              if (d.mode === "move") onMove(d, day);
            },
          });

          return (
            <section
              key={day}
              {...dropHandlers}
              className={cn(
                "flex min-h-56 flex-col rounded-2xl border bg-bg-card p-2 print:min-h-40 print:break-inside-avoid",
                isToday(day) ? "border-border-gold" : "border-border-2",
                dropClass(state)
              )}
            >
              <header className="mb-2 flex items-baseline justify-between px-1">
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider",
                    isToday(day) ? "text-gold" : "text-t3"
                  )}
                >
                  {name}
                </span>
                <span className="font-mono text-sm text-t2">{num}</span>
              </header>

              <div className="flex flex-1 flex-col gap-1.5">
                {shifts.map((shift) => (
                  <ShiftCell
                    key={shift.id}
                    shift={shift}
                    accent={venueOf(shift.venue_id)?.accent}
                    venueName={venueOf(shift.venue_id)?.name}
                    onOpen={() => onOpen(day, shift)}
                  />
                ))}
              </div>

              <button
                onClick={() => {
                  if (dnd.swallowClick()) return;
                  onCreate(day);
                }}
                className="focus-gold mt-1.5 rounded-lg border border-dashed border-border-2 py-1.5 text-xs text-t4 transition hover:border-border-gold hover:text-gold print:hidden"
              >
                + Turno
              </button>
            </section>
          );
        })}
      </div>
      <CoverageLegend />
    </div>
  );
}

function MonthGrid({
  days,
  month,
  byDay,
  onCreate,
  onOpen,
  onMove,
  venueOf,
}: {
  days: string[];
  month: Date;
  byDay: Map<string, ShiftWithAssignees[]>;
  onCreate: (day: string) => void;
  onOpen: (day: string, shift: ShiftWithAssignees) => void;
  onMove: (payload: MoveDragPayload, toDate: string) => void;
  /** La sede di un turno, per il bordo colorato. Vuoto con una sede sola. */
  venueOf: (venueId: string) => { name: string; accent: string } | undefined;
}) {
  const dnd = useShiftDrag();
  // Nel mese lo spazio per cella è poco: si mostrano i primi tre turni e si
  // conta il resto, invece di comprimerli fino a renderli illeggibili.
  const MAX_VISIBLE = 3;

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-2">
        {WEEKDAY_NAMES.map((n) => (
          <span
            key={n}
            className="px-1 text-xs font-semibold uppercase tracking-wider text-t4"
          >
            {n}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const shifts = byDay.get(day) ?? [];
          const inMonth = isSameMonth(day, month);
          const today = isToday(day);
          const visible = shifts.slice(0, MAX_VISIBLE);
          const hidden = shifts.length - visible.length;
          // Anche i giorni fuori mese accettano: sono date vere, e spostare un
          // turno a cavallo di mese è un gesto legittimo.
          const { state, ...dropHandlers } = dnd.dropProps({
            key: `month:${day}`,
            accepts: (d) => d.mode === "move" && d.sourceDate !== day,
            onDrop: (d) => {
              if (d.mode === "move") onMove(d, day);
            },
          });

          return (
            <section
              key={day}
              {...dropHandlers}
              className={cn(
                "group flex min-h-28 flex-col rounded-xl border p-1.5 print:break-inside-avoid",
                today
                  ? "border-border-gold bg-bg-card"
                  : "border-border-2 bg-bg-card",
                // I giorni fuori mese restano visibili ma arretrano: servono a
                // completare le settimane, non a essere letti.
                !inMonth && "opacity-40",
                dropClass(state)
              )}
            >
              <header className="mb-1 flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "font-mono text-xs",
                    today ? "font-bold text-gold" : "text-t3"
                  )}
                >
                  {day.slice(8)}
                </span>
                <button
                  onClick={() => {
                    if (dnd.swallowClick()) return;
                    onCreate(day);
                  }}
                  aria-label={`Aggiungi turno il ${day}`}
                  className="focus-gold rounded px-1 text-xs text-t4 opacity-0 transition hover:text-gold group-hover:opacity-100 print:hidden"
                >
                  +
                </button>
              </header>

              <div className="flex flex-1 flex-col gap-1">
                {visible.map((shift) => {
                  const counts = shiftCounts(shift);
                  const cancelled = shift.status === "cancelled";
                  const tone = shiftTone(shift);
                  return (
                    <button
                      key={shift.id}
                      onClick={() => {
                        if (dnd.swallowClick()) return;
                        onOpen(day, shift);
                      }}
                      {...(cancelled
                        ? {}
                        : dnd.dragProps(
                            {
                              mode: "move",
                              shiftId: shift.id,
                              title: shift.title,
                              sourceDate: shift.date,
                            },
                            shift.title
                          ))}
                      title={
                        cancelled
                          ? `${shift.title} · annullato: riattivalo dal pannello per spostarlo`
                          : [
                              venueOf(shift.venue_id)?.name,
                              shift.title,
                              formatShiftRange(shift.start_time, shift.end_time),
                              `${counts.filled}/${counts.total}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                      }
                      className={cn(
                        "focus-gold flex items-center gap-1 rounded border-l-2 bg-bg-1 py-0.5 pl-1 pr-0.5 text-left transition hover:bg-bg-2",
                        TONE_BORDER[tone],
                        cancelled
                          ? "opacity-50"
                          : "cursor-grab active:cursor-grabbing",
                        dnd.isSource(shift.id) && "opacity-40"
                      )}
                    >
                      {/* Il bordo sinistro qui dice già la copertura: la sede
                          prende un pallino, che è l'unico spazio rimasto. Il
                          nome sta nel tooltip. */}
                      {venueOf(shift.venue_id) ? (
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: venueOf(shift.venue_id)!.accent,
                          }}
                        />
                      ) : null}
                      <span className="shrink-0 font-mono text-[10px] text-t4">
                        {formatTime(shift.start_time)}
                        {/* Qui c'è posto solo per l'ora d'inizio: senza questo,
                            un 22:00 che finisce alle 04:00 è identico a uno che
                            finisce alle 23:00, nella vista più fitta del prodotto. */}
                        {isOvernightShift(shift.start_time, shift.end_time) ? (
                          <span className="ml-0.5 text-gold">+1</span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "truncate text-[11px] text-t1",
                          cancelled && "line-through"
                        )}
                      >
                        {shift.title}
                      </span>
                    </button>
                  );
                })}
                {hidden > 0 ? (
                  <span className="pl-1 text-[10px] text-t4">
                    +{hidden} altr{hidden === 1 ? "o" : "i"}
                  </span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <CoverageLegend />
    </div>
  );
}

function ShiftCell({
  shift,
  accent,
  venueName,
  onOpen,
}: {
  shift: ShiftWithAssignees;
  /** Il colore della sede. Assente con una sede sola. */
  accent?: string;
  venueName?: string;
  onOpen: () => void;
}) {
  const dnd = useShiftDrag();
  const cancelled = shift.status === "cancelled";
  const tone = shiftTone(shift);
  const { filled, total, short } = shiftCounts(shift);

  // Il dettaglio per ruolo sta nel tooltip: in una cella larga un settimo di
  // schermo non ci sta, ma è quello che dice *chi* manca — ed è l'unica cosa
  // che la vecchia pagina Copertura avesse in più di questa griglia.
  const roles = shiftCoverage(shift)
    .rows.map((r) => `${r.role} ${r.covered}/${r.required}`)
    .join(" · ");
  const hint = cancelled
    ? "Turno annullato: riattivalo dal pannello per spostarlo."
    : [venueName, roles].filter(Boolean).join(" · ") || undefined;

  return (
    <button
      onClick={() => {
        if (dnd.swallowClick()) return;
        onOpen();
      }}
      // Un turno annullato non si trascina: `notify_on_shift_change` salta i
      // turni cancellati, quindi spostarlo non avviserebbe nessuno — e chi lo
      // ha spostato non lo saprebbe.
      {...(cancelled
        ? {}
        : dnd.dragProps(
            {
              mode: "move",
              shiftId: shift.id,
              title: shift.title,
              sourceDate: shift.date,
            },
            shift.title
          ))}
      title={hint}
      // Il bordo sinistro dice la **copertura**, come nella vista mese: è la cosa
      // che si cerca scorrendo una griglia, ed è l'unica che cambia il da farsi.
      // Fino al 14/09/2026 qui lo prendeva la sede, e lo stesso colore voleva
      // dire due cose diverse a seconda della vista aperta. La sede ha il suo
      // supporto sotto: pallino più nome.
      className={cn(
        // Niente bordo dorato al passaggio del mouse: colorerebbe **tutti** i
        // lati, compreso quello sinistro, cioè spegnerebbe il segnale della
        // copertura proprio mentre ci si sta lavorando. Basta il fondo.
        "focus-gold rounded-lg border border-l-[3px] p-2 text-left transition",
        cancelled
          ? "border-border bg-bg-1 opacity-50"
          : "cursor-grab border-border-2 bg-bg-1 hover:bg-bg-2 active:cursor-grabbing",
        // Dopo il colore di bordo generico, sennò `cn()` lo considera vinto.
        TONE_BORDER[tone],
        dnd.isSource(shift.id) && "opacity-40"
      )}
    >
      <p
        className={cn(
          "truncate text-xs font-semibold text-t1",
          cancelled && "line-through"
        )}
      >
        {shift.title}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-t3">
        {formatShiftRange(shift.start_time, shift.end_time)}
      </p>
      {/* La sede, da quando il bordo dice la copertura: pallino come appiglio e
          nome come verità, che è l'unica coppia che sopravvive alla stampa in
          bianco e nero. */}
      {venueName ? (
        <p className="mt-0.5 flex items-center gap-1">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="truncate text-[10px] text-t4">{venueName}</span>
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {cancelled ? (
          <Pill tone="error">Annullato</Pill>
        ) : short ? (
          // Chi manca lo dice, chi è a posto si limita a contare: il verde su
          // ogni cella della settimana copriva di rumore le due che servono.
          <Pill tone="warning">
            {total - filled === 1 ? "Manca 1" : `Mancano ${total - filled}`}
          </Pill>
        ) : (
          <Pill tone="neutral">
            {filled}/{total}
          </Pill>
        )}
      </div>
    </button>
  );
}

/** Carica un turno per id e lo consegna una volta sola. Nessuna UI. */
function DeepLinkedShift({
  id,
  onResolved,
}: {
  id: string;
  onResolved: (shift: Shift) => void;
}) {
  const { data } = useShift(id);
  useEffect(() => {
    if (data) onResolved(data);
    // `onResolved` azzera il parametro che smonta questo componente: non serve
    // (né si vuole) rieseguire l'effetto se l'identità della callback cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}
