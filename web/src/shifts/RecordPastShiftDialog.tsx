import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useRecordPastShift } from "@/features/assignments/hooks";
import {
  formatShiftSummary,
  isValidShiftRange,
  SHIFT_RANGE_ERROR,
  shiftSlotLabel,
  todayString,
} from "@/lib/format";
import { MAX_BREAK_MINUTES, shiftBreakError } from "@/features/shifts/breaks";
import {
  RECORD_INTRO,
  RECORD_NOTE_PLACEHOLDER,
  RECORD_NOTIFY_HINT,
  RECORD_NOTIFY_LABEL,
  RECORD_NOT_FINISHED,
  RECORD_TITLE,
  canRecordShift,
} from "@/features/shifts/recorded";
import { usePlanChecks } from "@/features/shifts/usePlanChecks";
import { useShiftBreak } from "@/features/shifts/useShiftBreak";
import { staffRoleNames, type StaffMemberWithWaiter } from "@/features/staff/api";
import { useVenueStaff } from "@/features/staff/hooks";
import { STAFF_SEARCH_FROM, matchesStaffSearch } from "@/features/staff/search";
import { useSelfStaff } from "@/features/staff/self";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { cn } from "@/lib/cn";
import { PersonAvatar } from "../ui/PersonAvatar";
import { Button, Field, Input, Select, Textarea } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * Registra un turno **già fatto** che non era stato pianificato: chi ha «Ore»
 * sceglie il giorno passato, l'orario e chi ha lavorato. Le persone risultano
 * presenti e le ore contano subito (`record_past_shift`), senza notifiche di
 * turno assegnato: è lavoro svolto, non un invito.
 *
 * Gemello del form dell'app (`RecordPastShiftForm`): stesse frasi
 * (`recorded.ts`) e stessi avvisi sotto i nomi (`usePlanChecks`). «Già in
 * turno» qui conta doppio: di solito vuol dire che quel turno c'è già.
 */
export function RecordPastShiftDialog({
  date,
  initialPersonIds,
  defaultVenueId,
  onClose,
}: {
  /** Il giorno da proporre; uno futuro diventa oggi. */
  date?: string;
  /**
   * Persone già scelte (id di persona), dalla casella vuota della vista per
   * persona: la scheda giusta si risolve quando l'organico della sede arriva.
   */
  initialPersonIds?: string[];
  /** La sede filtrata nel planning, se lì si registrano le ore. */
  defaultVenueId?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { venuesWith, isOwner } = useOwnerVenues();
  const self = useSelfStaff();
  const venues = venuesWith("can_view_hours");
  const last = useLastVenue();
  const record = useRecordPastShift();

  const today = todayString();
  const [venueId, setVenueId] = useState(
    () =>
      venues.find((v) => v.id === defaultVenueId)?.id ??
      venues.find((v) => v.id === last.venueId)?.id ??
      venues[0]?.id ??
      ""
  );
  const venue = venues.find((v) => v.id === venueId) ?? null;
  const [day, setDay] = useState(() => (date && date <= today ? date : today));
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const pause = useShiftBreak(venue, start, end);
  // `null` finché non si tocca niente: vale la preselezione (sotto).
  const [touched, setTouched] = useState<Record<string, string | null> | null>(null);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const [search, setSearch] = useState("");

  const staffQuery = useVenueStaff(venueId || undefined);
  // Solo chi è attivo in organico; le proprie ore le registra solo il titolare.
  const staff = (staffQuery.data ?? []).filter(
    (m) => m.link_status === "active" && (isOwner || !self.isSelf(m.waiter_id))
  );
  // La preselezione è derivata, non copiata in uno stato: vale finché non si
  // tocca la scelta, poi conta solo quella (così non riseleziona chi si è tolto).
  const wanted = new Set(initialPersonIds ?? []);
  const preselected: Record<string, string | null> = Object.fromEntries(
    staff.filter((m) => wanted.has(m.person_id)).map((m) => [m.id, null])
  );
  const selected = touched ?? preselected;
  function setSelected(
    update: (prev: Record<string, string | null>) => Record<string, string | null>
  ) {
    setTouched((prev) => update(prev ?? preselected));
  }
  const shown = staff.filter(
    (m) => m.id in selected || matchesStaffSearch(m, search)
  );

  const times = { date: day, start_time: start, end_time: end };
  const checks = usePlanChecks({ dates: day ? [day] : [], ...times });
  const validRange = !!start && !!end && isValidShiftRange(start, end);
  const pauseError = validRange ? shiftBreakError(start, end, pause.minutes) : null;
  const finished = validRange && !!day && canRecordShift(times);
  const people = Object.keys(selected);
  const timesError = !validRange
    ? SHIFT_RANGE_ERROR
    : pauseError ?? (finished ? null : RECORD_NOT_FINISHED);
  const canSave = !!venueId && people.length > 0 && !timesError && !record.isPending;

  function chooseVenue(id: string) {
    if (id === venueId) return;
    // Le persone sono della sede: cambiando sede la scelta si azzera.
    setTouched({});
    setVenueId(id);
    last.choose(id);
  }

  function toggle(member: StaffMemberWithWaiter) {
    setSelected((prev) => {
      if (member.id in prev) {
        const next = { ...prev };
        delete next[member.id];
        return next;
      }
      // Con una mansione sola non c'è niente da scegliere.
      const own = member.staff_member_roles
        .map((r) => r.role)
        .filter((r): r is NonNullable<typeof r> => !!r);
      return { ...prev, [member.id]: own.length === 1 ? own[0].id : null };
    });
  }

  function save() {
    if (!canSave) return;
    record.mutate(
      {
        venue_id: venueId,
        // La fascia oraria, come i turni creati dall'app (mai la data).
        title: shiftSlotLabel(start),
        ...times,
        break_minutes: pause.minutes,
        note: note.trim() || null,
        staff: people.map((id) => ({ venue_member_id: id, role_id: selected[id] })),
        notify,
      },
      {
        onSuccess: () => {
          toast.show("Turno registrato: le ore contano già.");
          onClose();
        },
      }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label={RECORD_TITLE}
        className="relative flex max-h-[min(90vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-2 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-xl text-t1">{RECORD_TITLE}</h2>
            <p className="mt-1 max-w-xl text-xs leading-4 text-t3">{RECORD_INTRO}</p>
          </div>
          <Button onClick={onClose} aria-label="Chiudi">
            Chiudi
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {venues.length === 0 ? (
            <p className="text-sm text-t3">
              Per registrare un turno già fatto serve il permesso Ore su almeno una sede.
            </p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                {venues.length > 1 ? (
                  <Field label="Sede">
                    <Select value={venueId} onChange={(e) => chooseVenue(e.target.value)}>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Data">
                    {/* Solo il passato (e oggi, se il turno è già finito):
                        quello che deve ancora succedere si pianifica. */}
                    <Input
                      type="date"
                      max={today}
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </Field>
                  <Field label="Inizio">
                    <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  </Field>
                  <Field label="Fine">
                    <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </Field>
                </div>
                <Field label="Pausa (minuti)">
                  <Input
                    type="number"
                    min={0}
                    max={MAX_BREAK_MINUTES}
                    step={5}
                    value={pause.minutes}
                    onChange={(event) =>
                      pause.setMinutes(
                        Math.max(
                          0,
                          Math.min(
                            MAX_BREAK_MINUTES,
                            Math.round(Number(event.target.value) || 0)
                          )
                        )
                      )
                    }
                    className="w-28"
                  />
                </Field>
                {timesError ? (
                  <p className="-mt-2 text-xs font-semibold text-error">{timesError}</p>
                ) : (
                  <p className="-mt-2 text-xs text-t4">
                    {formatShiftSummary(day, start, end, {
                      break_minutes: pause.minutes,
                      break_paid: venue?.break_paid ?? false,
                    })}
                  </p>
                )}
                <Field label="Nota (facoltativa)">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={RECORD_NOTE_PLACEHOLDER}
                  />
                </Field>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-2 bg-bg-1 p-3">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-gold"
                  />
                  <span>
                    <span className="block text-sm text-t1">{RECORD_NOTIFY_LABEL}</span>
                    <span className="mt-0.5 block text-xs leading-4 text-t4">
                      {RECORD_NOTIFY_HINT}
                    </span>
                  </span>
                </label>
              </div>

              <section>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
                  Chi ha lavorato ({people.length})
                </span>
                {staffQuery.isLoading ? (
                  <p className="text-xs text-t4">Caricamento organico…</p>
                ) : staff.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border-2 px-3 py-4 text-center text-xs text-t4">
                    Nessuno in organico in questa sede.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {staff.length >= STAFF_SEARCH_FROM ? (
                      <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cerca per nome o ruolo…"
                        aria-label="Cerca nell'organico"
                        className="mb-1"
                      />
                    ) : null}
                    {shown.map((member) => {
                      const on = member.id in selected;
                      const own = member.staff_member_roles
                        .map((r) => r.role)
                        .filter((r): r is NonNullable<typeof r> => !!r)
                        .sort((a, b) => a.sort_order - b.sort_order);
                      const chosen = selected[member.id] ?? null;
                      // Assente, già in turno a quell'ora: avvisi, mai blocchi.
                      const notes = checks.notesFor(member.person_id);
                      return (
                        <div key={member.id}>
                          <button
                            type="button"
                            onClick={() => toggle(member)}
                            aria-pressed={on}
                            className={cn(
                              "focus-gold flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition",
                              on
                                ? "border-border-gold bg-gold/10"
                                : "border-border-2 bg-bg-1 hover:bg-bg-2"
                            )}
                          >
                            <PersonAvatar personId={member.person_id} name={member.display_name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-t1">
                                {member.display_name}
                              </span>
                              <span className="block truncate text-xs text-t4">
                                {staffRoleNames(member) ?? "Ruoli non indicati"}
                              </span>
                              {notes.map((n) => (
                                <span
                                  key={n}
                                  className="block truncate text-xs font-semibold text-warning"
                                >
                                  {n}
                                </span>
                              ))}
                            </span>
                          </button>
                          {on && own.length > 1 ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2 pl-3">
                              <span className="text-xs text-t4">In questo turno:</span>
                              {own.map((r) => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() =>
                                    setSelected((prev) => ({
                                      ...prev,
                                      [member.id]: chosen === r.id ? null : r.id,
                                    }))
                                  }
                                  className={cn(
                                    "focus-gold rounded-full border px-2.5 py-0.5 text-xs transition",
                                    chosen === r.id
                                      ? "border-border-gold bg-gold/10 text-t1"
                                      : "border-border-2 text-t3 hover:bg-bg-2"
                                  )}
                                >
                                  {r.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-2 px-6 py-4">
          {record.isError ? (
            <p className="w-full rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {userErrorMessage(record.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" onClick={save} disabled={!canSave}>
              {record.isPending
                ? "Registrazione…"
                : people.length > 1
                  ? `Registra per ${people.length} persone`
                  : "Registra turno"}
            </Button>
            <Button onClick={onClose}>Annulla</Button>
          </div>
          {people.length === 0 ? (
            <p className="text-[11px] text-t4">Scegli chi ha lavorato.</p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
