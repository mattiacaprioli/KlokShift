import { useMemo } from "react";
import {
  computeWeekLoad,
  MAX_WEEK_HOURS,
  ORDINARY_WEEK_HOURS,
  type PersonShift,
} from "@/features/assignments/weekLoad";
import {
  ASSIGNMENT_STATUS_LABEL,
  isActiveAssignment,
} from "@/features/assignments/status";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { formatHours, formatShiftRange } from "@/lib/format";
import type { ShiftWithAssignees } from "@/features/shifts/api";
import { cn } from "@/lib/cn";
import { personRoleNames } from "@/features/staff/api";
import { dayLabel, isToday } from "../lib/week";
import { Pill, Placeholder, Spinner } from "../ui/primitives";
import {
  dropClass,
  useShiftDrag,
  type ReassignDragPayload,
  type ReassignTarget,
} from "./dragContext";

/**
 * La settimana pivotata **per persona**: righe = organico, colonne = giorni.
 *
 * Le altre due viste rispondono a «cosa succede giovedì»; questa risponde a
 * «chi lavora quanto», che è la domanda che nessuna schermata copriva — e che
 * conviene farsi *mentre* si assegna, non a fine mese davanti al riepilogo ore.
 */
export function PeopleWeek({
  days,
  shifts,
  venueIds,
  onOpen,
  onCreate,
  onReassign,
}: {
  days: string[];
  shifts: ShiftWithAssignees[];
  /**
   * Le sedi che `shifts` contiene: tutte quelle dell'azienda, o la sola sede
   * scelta col filtro per locale del Planning. Qui serve a due cose — tenere
   * nelle righe solo chi lavora in quelle sedi, e dire che le ore sono parziali
   * quando il filtro è acceso (le soglie 40h/48h sono **della persona**, su
   * tutte le sedi: con un locale solo sotto gli occhi, un totale basso non è una
   * promessa che la persona sia scarica).
   */
  venueIds: string[];
  onOpen: (shift: ShiftWithAssignees) => void;
  /**
   * Casella vuota: un turno nuovo quel giorno, già assegnato a quella persona.
   *
   * Passa un `staff_people.id` e non uno `staff_members.id`: qui le righe sono
   * persone, e in quale sede lavorerà lo decide il pannello, dove la sede è un
   * campo del form.
   */
  onCreate: (date: string, personId: string) => void;
  /** Turno trascinato sulla riga di un'altra persona dello stesso giorno. */
  onReassign: (payload: ReassignDragPayload, to: ReassignTarget) => void;
}) {
  const { ownerId, venues, isMultiVenue } = useOwnerVenues();
  const peopleQuery = useOwnerPeople(ownerId);
  const dnd = useShiftDrag();

  /** Il filtro per locale del Planning è acceso: si vede una sede sola. */
  const filtered = venueIds.length < venues.length;
  /**
   * Più sedi **in questa griglia**: è la condizione per scrivere il locale sui
   * turni. Con il filtro acceso il locale è già nel titolo della pagina, e
   * ripeterlo su ogni chip toglierebbe spazio all'orario.
   */
  const showVenue = isMultiVenue && venueIds.length > 1;

  /**
   * Nome e colore del locale di un turno. L'indice è quello di `venues`, non di
   * `venueIds`: il colore di una sede non deve cambiare quando si filtra.
   */
  const venueOf = (venueId: string) => {
    if (!isMultiVenue) return null;
    const i = venues.findIndex((v) => v.id === venueId);
    return i < 0 ? null : { name: venues[i].name, accent: venueAccent(i) };
  };

  const byId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  /**
   * L'appartenenza di una persona **in una sede**, o `undefined` se lì non
   * lavora. È il cuore del drag & drop dopo l'unificazione: riassegnare vuole
   * uno `staff_members.id`, e quello giusto dipende dalla sede del turno che si
   * sta trascinando. Nessun vincolo del database lo impedisce — un'assegnazione
   * con `staff_member.venue_id ≠ shift.venue_id` passerebbe in silenzio, e poi
   * `role_id` punterebbe a un ruolo di un altro locale.
   */
  const membershipOf = useMemo(() => {
    const map = new Map<string, ReassignTarget>();
    for (const p of peopleQuery.data ?? []) {
      for (const m of p.memberships) {
        // Solo le appartenenze attive: un invito non ancora accettato non è
        // qualcuno a cui si può passare un turno.
        if (m.link_status !== "active") continue;
        map.set(`${p.id}:${m.venue_id}`, {
          id: m.id,
          person_id: p.id,
          display_name: p.full_name,
          waiter_id: p.waiter_id,
          roles: m.staff_member_roles
            .map((r) => r.role)
            .filter((r): r is NonNullable<typeof r> => !!r),
        });
      }
    }
    return map;
  }, [peopleQuery.data]);

  const rows = useMemo(() => {
    const scope = new Set(venueIds);
    const roster = (peopleQuery.data ?? [])
      // Con il filtro acceso restano solo le righe di chi in quella sede
      // lavora davvero: gli altri comparirebbero a zero ore, e una colonna di
      // zeri che non si possono riempire è rumore, non informazione.
      .filter((p) =>
        p.memberships.some(
          (m) => m.link_status === "active" && scope.has(m.venue_id)
        )
      )
      .map((p) => ({
        person_id: p.id,
        display_name: p.full_name,
        roles: personRoleNames(p),
      }));
    return computeWeekLoad(shifts, roster);
  }, [shifts, peopleQuery.data, venueIds]);

  if (peopleQuery.isPending) return <Spinner />;

  if (rows.length === 0) {
    return filtered ? (
      <Placeholder
        title="Nessuno lavora in questo locale"
        detail="Assegna delle persone a questa sede dalla sezione Staff, oppure togli il filtro per vedere tutta l'azienda."
      />
    ) : (
      <Placeholder
        title="Nessuno nel tuo organico"
        detail="Aggiungi le persone che lavorano per te dalla sezione Staff: qui vedrai come si distribuiscono i turni fra loro."
      />
    );
  }

  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const working = rows.filter((r) => r.hours > 0).length;

  return (
    <div>
      {/* Sullo schermo la griglia ha una larghezza minima e scorre; sul foglio
          non c'è scroll, quindi si lascia stringere alla pagina. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-5xl print:min-w-0">
          {/* Intestazione: gli stessi giorni delle altre viste. */}
          <div className="mb-2 grid grid-cols-[12rem_repeat(7,minmax(0,1fr))_5rem] gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-t4">
              Persona
            </span>
            {days.map((day) => {
              const { name, num } = dayLabel(day);
              return (
                <span
                  key={day}
                  className={cn(
                    "px-1 text-xs font-semibold uppercase tracking-wider",
                    isToday(day) ? "text-gold" : "text-t4"
                  )}
                >
                  {name} <span className="font-mono">{num}</span>
                </span>
              );
            })}
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-t4">
              {filtered ? "Ore qui" : "Ore"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {rows.map((person) => (
              <div
                key={person.personId}
                className="grid grid-cols-[12rem_repeat(7,minmax(0,1fr))_5rem] items-stretch gap-1.5 print:break-inside-avoid"
              >
                <div className="flex min-w-0 flex-col justify-center rounded-xl border border-border-2 bg-bg-card px-3 py-2">
                  <span className="truncate text-sm text-t1">
                    {person.name}
                  </span>
                  <span className="truncate text-xs text-t4">
                    {person.roles ?? "Ruoli non indicati"}
                  </span>
                </div>

                {days.map((day) => {
                  const dayShifts = person.byDay.get(day) ?? [];
                  // Si accetta solo dalla stessa colonna: trascinare su un
                  // altro giorno *di un'altra persona* sarebbe spostamento e
                  // riassegnazione insieme, e nessuno saprebbe cosa aspettarsi.
                  //
                  // ⚠️ E solo se la persona lavora **nella sede di quel turno**:
                  // è l'unico controllo che impedisce un'assegnazione incoerente,
                  // perché il database la accetterebbe senza dire niente.
                  const { state, ...dropHandlers } = dnd.dropProps({
                    key: `person:${person.personId}:${day}`,
                    accepts: (d) =>
                      d.mode === "reassign" &&
                      d.date === day &&
                      membershipOf.get(`${person.personId}:${d.venueId}`)?.id !==
                        undefined &&
                      membershipOf.get(`${person.personId}:${d.venueId}`)?.id !==
                        d.fromStaffMemberId,
                    onDrop: (d) => {
                      if (d.mode !== "reassign") return;
                      const to = membershipOf.get(
                        `${person.personId}:${d.venueId}`
                      );
                      if (to) onReassign(d, to);
                    },
                  });

                  // Casella vuota: è il punto in cui si vede che la persona è
                  // libera, quindi è anche il punto naturale per darle un turno.
                  if (dayShifts.length === 0) {
                    return (
                      <button
                        key={day}
                        onClick={() => {
                          if (dnd.swallowClick()) return;
                          onCreate(day, person.personId);
                        }}
                        aria-label={`Nuovo turno per ${person.name} il ${day}`}
                        {...dropHandlers}
                        className={cn(
                          "focus-gold flex min-h-14 items-center justify-center rounded-xl border border-dashed border-border text-sm text-transparent transition hover:border-border-gold hover:text-gold",
                          dropClass(state)
                        )}
                      >
                        +
                      </button>
                    );
                  }
                  return (
                    <div
                      key={day}
                      {...dropHandlers}
                      className={cn(
                        "flex min-h-14 flex-col gap-1 rounded-xl border border-border-2 bg-bg-card p-1",
                        dropClass(state)
                      )}
                    >
                      {dayShifts.map((ps) => (
                        <PersonShiftChip
                          key={ps.shiftId}
                          personShift={ps}
                          fromStaffName={person.name}
                          venue={venueOf(ps.venueId)}
                          showVenue={showVenue}
                          busyStaffIds={
                            byId
                              .get(ps.shiftId)
                              ?.shift_assignments.map(
                                (a) => a.staff_member?.id ?? ""
                              ) ?? []
                          }
                          onOpen={() => {
                            const shift = byId.get(ps.shiftId);
                            if (shift) onOpen(shift);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}

                <HoursCell
                  hours={person.hours}
                  daysWorked={person.daysWorked}
                  partial={filtered}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-t4">
        <span>
          <b className="font-mono text-t2">{formatHours(totalHours)}</b>{" "}
          programmate in totale · {working} di {rows.length}{" "}
          {rows.length === 1 ? "persona" : "persone"} al lavoro
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-warning" /> oltre le{" "}
          {ORDINARY_WEEK_HOURS} h ordinarie, o senza un giorno di riposo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-error" /> oltre le{" "}
          {MAX_WEEK_HOURS} h settimanali
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-t4">
        Sono ore <b>programmate</b>, calcolate dagli orari dei turni: chi ha
        rifiutato o è stato segnato assente non le somma. Le ore effettivamente
        lavorate — quelle che vanno al commercialista — stanno nella pagina Ore.
        {isMultiVenue && !filtered ? (
          <>
            {" "}
            Le ore sono <b>della persona</b>: i turni di tutti i tuoi locali sono
            già contati qui, e un turno si può passare solo a chi lavora nella sua
            stessa sede.
          </>
        ) : null}
        {filtered ? (
          <>
            {" "}
            Stai guardando <b>un locale solo</b>: le ore qui sotto sono quelle di
            questa sede, non il totale della persona. Le soglie di legge sono
            della persona — per vederle tutte, togli il filtro.
          </>
        ) : null}
      </p>
    </div>
  );
}

function PersonShiftChip({
  personShift,
  fromStaffName,
  venue,
  showVenue,
  busyStaffIds,
  onOpen,
}: {
  personShift: PersonShift;
  fromStaffName: string;
  /** Il locale del turno: nome e colore. `null` con un locale solo. */
  venue: { name: string; accent: string } | null;
  /**
   * Scrivere il nome del locale sul chip. Falso quando la griglia mostra una
   * sede sola: il nome sarebbe uguale su ogni turno.
   */
  showVenue: boolean;
  busyStaffIds: string[];
  onOpen: () => void;
}) {
  const dnd = useShiftDrag();
  const active = isActiveAssignment(personShift.status);
  const dragging = dnd.isSource(personShift.shiftId, personShift.assignmentId);

  return (
    <button
      onClick={() => {
        if (dnd.swallowClick()) return;
        onOpen();
      }}
      {...dnd.dragProps(
        {
          mode: "reassign",
          shiftId: personShift.shiftId,
          title: personShift.title,
          date: personShift.date,
          assignmentId: personShift.assignmentId,
          fromStaffMemberId: personShift.staffMemberId,
          fromStaffName,
          venueId: personShift.venueId,
          busyStaffIds,
        },
        `${personShift.title} · ${fromStaffName}`
      )}
      title={[
        venue?.name,
        personShift.title,
        formatShiftRange(personShift.start_time, personShift.end_time),
        active ? null : ASSIGNMENT_STATUS_LABEL[personShift.status],
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "focus-gold cursor-grab rounded-lg border px-1.5 py-1 text-left transition active:cursor-grabbing",
        active
          ? "border-border-gold bg-gold/10 hover:bg-gold/20"
          : // Non viene: resta visibile, perché è un buco da coprire, ma non
            // deve somigliare a una copertura.
            "border-border bg-bg-1 opacity-60 hover:opacity-100",
        dragging && "opacity-40"
      )}
    >
      <span
        className={cn(
          "block font-mono text-[10px]",
          active ? "text-gold" : "text-t4 line-through"
        )}
      >
        {formatShiftRange(personShift.start_time, personShift.end_time)}
      </span>
      <span className="block truncate text-[11px] text-t2">
        {active
          ? personShift.title
          : ASSIGNMENT_STATUS_LABEL[personShift.status]}
      </span>
      {/* Il locale, terza riga. Qui il nome si **scrive**: questa è la vista in
          cui una persona lavora in due sedi nella stessa settimana, e sapere
          dov'è giovedì è metà della domanda. Il pallino colorato è solo un
          appiglio — si stampa in grigio, il nome no. */}
      {showVenue && venue ? (
        <span className="mt-0.5 flex items-center gap-1">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: venue.accent }}
          />
          <span className="truncate text-[10px] text-t4">{venue.name}</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * Le ore della settimana, e il giudizio sulle soglie.
 *
 * È il totale **della persona**: da quando la vista contiene tutte le sedi non
 * c'è più un "qui" da distinguere da un "altrove", e quelle 55 ore che prima
 * erano due celle verdi da 30 e 25 in due viste diverse sono una cella rossa
 * sola. Le soglie di legge sono della persona, non del locale.
 */
function HoursCell({
  hours,
  daysWorked,
  partial,
}: {
  hours: number;
  daysWorked: number;
  /**
   * Il filtro per locale è acceso: qui c'è **una parte** delle ore della
   * persona. Le soglie restano vere quando scattano — le ore filtrate non
   * superano mai quelle vere — ma una cella tranquilla non promette più niente,
   * e va detto.
   */
  partial: boolean;
}) {
  const over = hours > MAX_WEEK_HOURS;
  const heavy = hours > ORDINARY_WEEK_HOURS;
  // Sette giorni su sette significa nessun riposo settimanale — e i giorni si
  // contano su tutte le sedi, perché il riposo è uno.
  const noRest = daysWorked >= 7;

  return (
    <div
      title={
        partial
          ? "Solo le ore di questo locale: togli il filtro per il totale della persona."
          : undefined
      }
      className={cn(
        "flex flex-col items-end justify-center rounded-xl border px-2 py-2",
        over
          ? "border-error/40 bg-error/10"
          : heavy || noRest
            ? "border-warning/40 bg-warning/10"
            : "border-border-2 bg-bg-card"
      )}
    >
      <span
        className={cn(
          "font-mono text-sm",
          over ? "text-error" : heavy ? "text-warning" : "text-t1"
        )}
      >
        {formatHours(hours)}
      </span>

      {noRest && !over ? (
        <Pill tone="warning">0 riposi</Pill>
      ) : (
        <span className="text-[10px] text-t4">
          {daysWorked} {daysWorked === 1 ? "giorno" : "giorni"}
        </span>
      )}
    </div>
  );
}
