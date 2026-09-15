import { useEffect, useMemo, useRef, useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCreateInternalShifts,
  useShiftAssignments,
  useShiftRoleRequirements,
  useUpdateInternalShift,
} from "@/features/assignments/hooks";
import { useUpdateShiftStatus } from "@/features/shifts/hooks";
import { useVenueStaff } from "@/features/staff/hooks";
import { Link } from "react-router-dom";
import { useVenueRoles } from "@/features/roles/hooks";
import {
  staffRoleNames,
  type StaffMemberWithWaiter,
} from "@/features/staff/api";
import { computeCoverage } from "@/features/assignments/coverage";
import {
  ASSIGNMENT_STATUS_LABEL,
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import { formatShiftSummary, isShiftOver } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Shift } from "@/features/shifts/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useLastVenue } from "@/features/venues/useLastVenue";
import { dayLabel, startOfWeek, weekDays } from "../lib/week";
import {
  Button,
  Field,
  Input,
  Pill,
  Select,
  Textarea,
} from "../ui/primitives";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { PresenceSection } from "./PresenceSection";
import { usePendingRequestsForShift } from "@/features/changeRequests/hooks";
import { internalShiftSchema, type InternalShiftForm } from "./schema";

type RoleTarget = { role_id: string; count: number };

/**
 * Pannello laterale di creazione/modifica turno: il gestore sceglie giorno e
 * orario e assegna le persone del proprio organico. È il caso d'uso da
 * scrivania, ed è il motivo per cui il pannello vive dentro il planning.
 */
export function ShiftPanel({
  date,
  shift,
  initialPersonIds,
  onClose,
}: {
  date: string;
  shift?: Shift;
  /**
   * Persone già selezionate in creazione, come `staff_people.id`. Serve alla
   * vista per persona: si clicca la casella vuota di chi è libero e il turno
   * nasce già suo.
   *
   * Id di **persona** e non di scheda, perché al momento del clic la sede non è
   * ancora stata scelta: la scheda giusta la risolve il form, una volta che sa
   * dove.
   */
  initialPersonIds?: string[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border-2 bg-bg-0 p-6">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl text-t1">
              {shift ? "Modifica turno" : "Nuovo turno"}
            </h2>
            <p className="mt-1 text-xs text-t3">Con il tuo staff interno</p>
          </div>
          <Button onClick={onClose} aria-label="Chiudi">
            Chiudi
          </Button>
        </header>

        <InternalForm
          date={date}
          shift={shift}
          initialPersonIds={initialPersonIds}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

/**
 * Annullare un turno non è una modifica come le altre: fa sparire il turno da
 * tutte le viste dei professionisti e manda una notifica a testa. Quindi si
 * chiede conferma, e la conferma dice anche che il passo è reversibile — è la
 * prima cosa che serve sapere quando si clicca per sbaglio.
 */
function CancelShiftButton({
  shift,
  onDone,
}: {
  shift: Shift;
  onDone: () => void;
}) {
  const toast = useToast();
  const status = useUpdateShiftStatus(shift.id);
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="danger"
        onClick={() => setAsking(true)}
        disabled={status.isPending}
      >
        Annulla turno
      </Button>
      {asking ? (
        <ConfirmDialog
          title="Annullare il turno?"
          message="Chi è assegnato riceve una notifica e il turno sparisce dalla sua agenda. Potrai ripristinarlo da qui."
          confirmLabel="Annulla il turno"
          cancelLabel="Lascialo attivo"
          destructive
          pending={status.isPending}
          onCancel={() => setAsking(false)}
          onConfirm={() =>
            status.mutate("cancelled", {
              onSuccess: () => {
                toast.show("Turno annullato");
                onDone();
              },
              onError: (e) => {
                toast.show(userErrorMessage(e), "error");
                setAsking(false);
              },
            })
          }
        />
      ) : null}
    </>
  );
}

/**
 * Il ritorno indietro dall'annullamento. Senza, un clic sbagliato costava il
 * turno: l'unico rimedio era ricrearlo da zero e riassegnare tutti.
 */
function RestoreShiftButton({
  shift,
  onDone,
}: {
  shift: Shift;
  onDone: () => void;
}) {
  const toast = useToast();
  const status = useUpdateShiftStatus(shift.id);
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="gold"
        onClick={() => setAsking(true)}
        disabled={status.isPending}
      >
        Ripristina turno
      </Button>
      {asking ? (
        <ConfirmDialog
          title="Ripristinare il turno?"
          message="Torna attivo con le persone che erano assegnate, e ognuna riceve una notifica."
          confirmLabel="Ripristina turno"
          pending={status.isPending}
          onCancel={() => setAsking(false)}
          onConfirm={() =>
            status.mutate("open", {
              onSuccess: () => {
                toast.show("Turno ripristinato");
                onDone();
              },
              onError: (e) => {
                toast.show(userErrorMessage(e), "error");
                setAsking(false);
              },
            })
          }
        />
      ) : null}
    </>
  );
}

/** Striscia «questo turno è annullato» + il modo per tornare indietro. */
function CancelledBanner({
  shift,
  onDone,
}: {
  shift: Shift;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/40 bg-error/10 px-3 py-3">
      <p className="text-xs leading-4 text-error">
        Turno annullato. Non compare più a chi era assegnato.
      </p>
      <RestoreShiftButton shift={shift} onDone={onDone} />
    </div>
  );
}

function InternalForm({
  date,
  shift,
  initialPersonIds,
  onClose,
}: {
  date: string;
  shift?: Shift;
  initialPersonIds?: string[];
  onClose: () => void;
}) {
  // Solo le sedi su cui si possono fare i turni: il selettore non deve offrire
  // una sede su cui l'insert verrebbe poi rifiutato dalla RLS.
  const { venuesWith } = useOwnerVenues();
  const venues = venuesWith("can_manage_shifts");
  const isMultiVenue = venues.length > 1;
  const { venueId: lastVenueId, choose } = useLastVenue();
  // In creazione non c'è ancora un turno: senza `enabled` il pannello faceva
  // due query con id vuoto ogni volta che si apriva.
  const assignmentsQuery = useShiftAssignments(shift?.id ?? "", !!shift?.id);
  const roleReqsQuery = useShiftRoleRequirements(shift?.id ?? "", !!shift?.id);
  const create = useCreateInternalShifts();
  const update = useUpdateInternalShift(shift?.id ?? "");
  // Chi ha chiesto di essere sostituito: la decisione si prende in chat, dove
  // c'è il motivo. Qui è solo il segnale che c'è una risposta da dare.
  const changeRequests = usePendingRequestsForShift(shift?.id ?? "", !!shift?.id);
  const cancelled = shift?.status === "cancelled";

  // Chi lavora **e** in che ruolo: la chiave è la scheda di sede
  // (`staff_members.id`), il valore il ruolo che ricopre in questo turno
  // (null = più mansioni, ancora da scegliere).
  const [staffRoles, setStaffRoles] = useState<Record<string, string | null>>(
    {}
  );
  const [roleTargets, setRoleTargets] = useState<RoleTarget[]>([]);
  // Giorni **in più** su cui ripetere lo stesso turno, in creazione.
  const [extraDates, setExtraDates] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<InternalShiftForm>({
    resolver: zodResolver(internalShiftSchema),
    defaultValues: {
      // In modifica la sede è quella del turno e non si tocca (vedi il campo);
      // in creazione si propone l'ultima usata, la stessa del form mobile.
      venue_id: shift?.venue_id ?? lastVenueId ?? venues[0]?.id ?? "",
      title: shift?.title ?? "",
      date: shift?.date ?? date,
      start_time: shift?.start_time?.slice(0, 5) ?? "18:00",
      end_time: shift?.end_time?.slice(0, 5) ?? "23:00",
      description: shift?.description ?? "",
      require_confirmation: shift?.require_confirmation ?? false,
    },
  });

  /**
   * La sede su cui il form sta lavorando: da lei dipendono organico e mansioni
   * selezionabili. In modifica è quella del turno, sempre.
   */
  const formVenueId = shift?.venue_id ?? watch("venue_id");
  const staffQuery = useVenueStaff(formVenueId || undefined);
  const rolesQuery = useVenueRoles(formVenueId || undefined);

  // Su un turno esistente, assegnati e fabbisogni arrivano da due query: si
  // sincronizzano nello stato locale appena disponibili.
  // ⚠️ Solo su un turno esistente: in creazione la query gira con id vuoto e
  // sovrascriverebbe `initialPersonIds` con una lista vuota.
  useEffect(() => {
    if (shift && assignmentsQuery.data) {
      setStaffRoles(
        Object.fromEntries(
          assignmentsQuery.data
            .filter((a) => !!a.staff_member_id)
            .map((a) => [a.staff_member_id, a.role_id])
        )
      );
    }
  }, [shift, assignmentsQuery.data]);

  useEffect(() => {
    if (roleReqsQuery.data) {
      setRoleTargets(
        roleReqsQuery.data.map((r) => ({ role_id: r.role_id, count: r.count }))
      );
    }
  }, [roleReqsQuery.data]);

  /**
   * Cambiare sede azzera persone e fabbisogni.
   *
   * Non è pulizia estetica: le chiavi di `staffRoles` sono `staff_members.id`
   * della sede precedente e quelle di `roleTargets` sono `venue_roles.id` della
   * sede precedente. Portarle su un turno di un'altra sede produce assegnazioni
   * incoerenti che **il database accetta** — nessuna FK lega
   * `shift_assignments.staff_member_id` alla sede del turno.
   *
   * ⚠️ Due guardie, non una. Su un turno esistente esce subito: lì il campo è
   * disabilitato, e senza la guardia l'effetto sovrascriverebbe gli assegnati
   * appena caricati da `assignmentsQuery` — lo stesso inciampo già documentato
   * per `initialPersonIds`. E il `ref` salta il primo giro: al mount la sede non
   * è *cambiata*, e azzerare lì butterebbe via la preselezione con cui il
   * pannello è stato aperto dalla vista per persona.
   */
  const lastVenueRef = useRef(formVenueId);
  useEffect(() => {
    if (shift) return;
    if (lastVenueRef.current === formVenueId) return;
    lastVenueRef.current = formVenueId;
    setStaffRoles({});
    setRoleTargets([]);
  }, [shift, formVenueId]);

  /**
   * La preselezione della vista per persona arriva come `staff_people.id`, e va
   * tradotta nella **scheda di quella persona nella sede scelta**: è quella che
   * si scrive in `shift_assignments`.
   *
   * Sta in un effetto e non nello stato iniziale perché dipende dall'organico,
   * che arriva una query dopo; e si applica una volta sola (`applied`), o
   * riselezionerebbe chi l'utente ha appena tolto. Chi non lavora in quella sede
   * semplicemente non entra: è la stessa regola del drag & drop.
   */
  const applied = useRef(false);
  useEffect(() => {
    if (shift || applied.current) return;
    if (!initialPersonIds?.length || staffQuery.data == null) return;
    const wanted = new Set(initialPersonIds);
    const picked = staffQuery.data.filter((m) => wanted.has(m.person_id));
    if (picked.length > 0) {
      setStaffRoles(Object.fromEntries(picked.map((m) => [m.id, null])));
    }
    applied.current = true;
  }, [shift, initialPersonIds, staffQuery.data]);

  const staff = staffQuery.data ?? [];
  const roles = rolesQuery.data ?? [];
  // La richiesta punta all'assegnazione; la riga qui è la persona: si passa per
  // gli assegnati del turno per tradurre l'una nell'altra.
  const requestedByStaff = useMemo(() => {
    const wanted = new Map(
      (changeRequests.data ?? [])
        .filter((r) => !!r.assignment_id)
        .map((r) => [r.assignment_id as string, r.kind])
    );
    return new Map(
      (assignmentsQuery.data ?? [])
        .filter((a) => wanted.has(a.id))
        .map((a) => [a.staff_member_id, wanted.get(a.id)])
    );
  }, [changeRequests.data, assignmentsQuery.data]);
  const staffIds = useMemo(() => Object.keys(staffRoles), [staffRoles]);
  const selectedStaff = useMemo(
    () => staff.filter((m) => m.id in staffRoles),
    [staff, staffRoles]
  );

  // Stato reale dell'assegnazione. Chi ha rifiutato (o è stato segnato assente)
  // resta in elenco ma NON copre il suo ruolo: darlo per `assigned` faceva
  // sembrare coperto un turno in cui quella persona non viene.
  const statusById = useMemo(
    () =>
      new Map<string, AssignmentStatus>(
        (assignmentsQuery.data ?? []).map((a) => [a.staff_member_id, a.status])
      ),
    [assignmentsQuery.data]
  );

  /** Chi viene selezionato ora non ha ancora una riga: sarà `assigned` al salvataggio. */
  function staffStatus(id: string): AssignmentStatus {
    return statusById.get(id) ?? "assigned";
  }

  const coverage = useMemo(
    () =>
      computeCoverage(
        roleTargets.map((t) => ({
          role_id: t.role_id,
          role: roles.find((r) => r.id === t.role_id)?.name ?? "Ruolo",
          count: t.count,
        })),
        selectedStaff.map((m) => ({
          status: statusById.get(m.id) ?? "assigned",
          role_id: staffRoles[m.id] ?? null,
        }))
      ),
    [roleTargets, roles, selectedStaff, staffRoles, statusById]
  );

  const workingCount = selectedStaff.filter((m) =>
    isActiveAssignment(staffStatus(m.id))
  ).length;

  function toggleStaff(member: StaffMemberWithWaiter) {
    setStaffRoles((prev) => {
      if (member.id in prev) {
        const next = { ...prev };
        delete next[member.id];
        return next;
      }
      // Con una mansione sola non c'è niente da scegliere; con due il ruolo
      // resta da decidere, perché indovinarlo falserebbe la copertura.
      const own = member.staff_member_roles
        .map((r) => r.role)
        .filter((r): r is NonNullable<typeof r> => !!r);
      return { ...prev, [member.id]: own.length === 1 ? own[0].id : null };
    });
  }

  function setStaffRole(staffId: string, roleId: string | null) {
    setStaffRoles((prev) => ({ ...prev, [staffId]: roleId }));
  }

  function setRoleCount(roleId: string, count: number) {
    setRoleTargets((prev) => {
      const rest = prev.filter((t) => t.role_id !== roleId);
      return count > 0 ? [...rest, { role_id: roleId, count }] : rest;
    });
  }

  // I sette giorni della settimana della data scelta: è lì che si ripete un
  // turno di servizio ("anche giovedì e sabato"), non a distanza di mesi.
  const formDate = watch("date");
  const formStart = watch("start_time");
  const formEnd = watch("end_time");
  const weekOfForm = useMemo(
    () => (formDate ? weekDays(startOfWeek(new Date(`${formDate}T00:00:00`))) : []),
    [formDate]
  );

  // Se si cambia data e si finisce in un'altra settimana, i giorni spuntati
  // prima non esistono più in griglia: si azzerano invece di restare invisibili
  // e creare turni a sorpresa.
  const weekKey = weekOfForm[0] ?? "";
  useEffect(() => {
    setExtraDates((prev) => prev.filter((d) => weekOfForm.includes(d)));
    // Dipende solo dal cambio di settimana: `weekOfForm` è derivato da lì.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  function toggleExtraDate(day: string) {
    setExtraDates((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  const pending = create.isPending || update.isPending;
  const mutationError = create.error ?? update.error;

  function onSubmit(values: InternalShiftForm) {
    const payload = {
      title: values.title,
      date: values.date,
      start_time: values.start_time,
      end_time: values.end_time,
      description: values.description.trim() || null,
      require_confirmation: values.require_confirmation,
      staff: staffIds.map((id) => ({
        staff_member_id: id,
        role_id: staffRoles[id] ?? null,
      })),
      roleTargets,
    };
    if (shift) {
      update.mutate(payload, { onSuccess: onClose });
      return;
    }
    // Un turno o dieci passano dalla stessa mutation: la data è l'unica cosa
    // che cambia tra le copie — la sede no, sono copie dello stesso turno.
    const dates = [values.date, ...extraDates.filter((d) => d !== values.date)];
    create.mutate(
      dates.sort().map((d) => ({ ...payload, venue_id: values.venue_id, date: d })),
      {
        onSuccess: () => {
          // La sede appena usata diventa quella proposta al prossimo turno.
          choose(values.venue_id);
          onClose();
        },
      }
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-1 flex-col gap-4"
    >
      {shift && cancelled ? (
        <CancelledBanner shift={shift} onDone={onClose} />
      ) : null}

      {/* Il primo campo: da questa risposta discendono organico e mansioni
          selezionabili. Con una sede sola non compare — la risposta è già nota.

          ⚠️ In modifica è disabilitato, e deve restarci: `updateInternalShift`
          non tocca `venue_id`, perché assegnazioni e fabbisogni già scritti
          puntano a `staff_members` e `venue_roles` di **questa** sede, e
          spostare il turno li lascerebbe appesi a righe di un'altra sede —
          cosa che il database accetterebbe senza dire niente. */}
      {isMultiVenue ? (
        <Field label="Sede" error={errors.venue_id?.message}>
          <Select {...register("venue_id")} disabled={!!shift}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Titolo" error={errors.title?.message}>
        <Input {...register("title")} placeholder="Servizio serale" />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Data" error={errors.date?.message}>
          <Input type="date" {...register("date")} />
        </Field>
        <Field label="Inizio" error={errors.start_time?.message}>
          <Input type="time" {...register("start_time")} />
        </Field>
        <Field label="Fine" error={errors.end_time?.message}>
          <Input type="time" {...register("end_time")} />
        </Field>
      </div>

      {formDate && formStart && formEnd ? (
        <p className="-mt-2 text-xs text-t4">
          {formatShiftSummary(formDate, formStart, formEnd)}
        </p>
      ) : null}

      {/* Solo in creazione: su un turno esistente "ripeti" vorrebbe dire
          crearne altri, cosa diversa dal modificare questo. */}
      {!shift ? (
        <section>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
            Ripeti anche il…
          </span>
          <div className="grid grid-cols-7 gap-1">
            {weekOfForm.map((day) => {
              const isMain = day === formDate;
              const on = isMain || extraDates.includes(day);
              const { name, num } = dayLabel(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isMain}
                  onClick={() => toggleExtraDate(day)}
                  title={isMain ? "È la data del turno" : undefined}
                  className={cn(
                    "focus-gold rounded-xl border py-1.5 text-center transition",
                    on
                      ? "border-border-gold bg-gold/10 text-gold"
                      : "border-border-2 bg-bg-1 text-t3 hover:bg-bg-2",
                    isMain && "cursor-default"
                  )}
                >
                  <span className="block text-[10px] uppercase">{name}</span>
                  <span className="block font-mono text-xs">{num}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-t4">
            {extraDates.length === 0
              ? "Stessi orari, staff e fabbisogno su più giorni della settimana."
              : `Verranno creati ${extraDates.length + 1} turni identici, uno per giorno.`}
          </p>
        </section>
      ) : null}

      <Field label="Note" hint="Visibili a chi è assegnato al turno.">
        <Textarea {...register("description")} />
      </Field>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-t3">
            Fabbisogno per ruolo
          </span>
          {coverage.required > 0 ? (
            <Pill tone={coverage.missing > 0 ? "warning" : "success"}>
              {coverage.covered}/{coverage.required} coperti
            </Pill>
          ) : null}
        </div>
        {roles.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 px-3 py-4 text-center text-xs text-t4">
            Nessun ruolo definito.{" "}
            <Link to="/ruoli" className="font-semibold text-gold">
              Creali ora
            </Link>{" "}
            per poterli chiedere sui turni.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {roles.map((role) => {
              const count =
                roleTargets.find((t) => t.role_id === role.id)?.count ?? 0;
              return (
                <div
                  key={role.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5",
                    count > 0
                      ? "border-border-gold bg-gold/5"
                      : "border-border-2 bg-bg-1"
                  )}
                >
                  <span className="truncate text-xs text-t2">{role.name}</span>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    value={count}
                    onChange={(e) =>
                      setRoleCount(
                        role.id,
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                    className="w-14 px-2 py-1 text-center font-mono text-xs"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
          Chi lavora ({workingCount})
        </span>
        {staff.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 px-3 py-4 text-center text-xs text-t4">
            Nessuno nel tuo organico. Aggiungi il personale dalla sezione Staff.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {staff.map((member) => {
              const on = member.id in staffRoles;
              const status = staffStatus(member.id);
              const works = isActiveAssignment(status);
              const own = member.staff_member_roles
                .map((r) => r.role)
                .filter((r): r is NonNullable<typeof r> => !!r)
                .sort((a, b) => a.sort_order - b.sort_order);
              const chosen = staffRoles[member.id] ?? null;
              return (
                <div key={member.id}>
                  <button
                    type="button"
                    onClick={() => toggleStaff(member)}
                    className={cn(
                      "focus-gold flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition",
                      on && works && "border-border-gold bg-gold/10",
                      on && !works && "border-error/40 bg-error/5",
                      !on && "border-border-2 bg-bg-1 hover:bg-bg-2"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-t1">
                        {member.display_name}
                      </span>
                      <span className="block truncate text-xs text-t4">
                        {staffRoleNames(member) ?? "Ruoli non indicati"}
                      </span>
                      {requestedByStaff.has(member.id) ? (
                        <span className="block truncate text-xs font-semibold text-gold">
                          {requestedByStaff.get(member.id) === "hours"
                            ? "Ha chiesto un altro orario"
                            : "Ha chiesto il cambio"}{" "}
                          · rispondi in chat
                        </span>
                      ) : null}
                    </span>
                    {on ? (
                      <Pill tone={works ? "gold" : "error"}>
                        {ASSIGNMENT_STATUS_LABEL[status]}
                      </Pill>
                    ) : null}
                  </button>

                  {/* Il ruolo si sceglie solo per chi ne ha più di uno: con una
                      mansione sola non c'è niente da decidere. */}
                  {on && own.length > 1 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-3">
                      <span className="text-xs text-t4">In questo turno:</span>
                      {own.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            setStaffRole(
                              member.id,
                              chosen === r.id ? null : r.id
                            )
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

      {/* Di norma la conferma la chiede solo chi è a chiamata: l'assegnazione di
          un dipendente fisso nasce già confermata (default_assignment_confirmation,
          20260915100000). Lo switch è per i turni fuori dall'ordinario. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-2 bg-bg-1 p-3">
        <input
          type="checkbox"
          {...register("require_confirmation")}
          className="mt-0.5 h-4 w-4 accent-gold"
        />
        <span>
          <span className="block text-sm text-t1">Chiedi conferma a tutti</span>
          <span className="mt-0.5 block text-xs leading-4 text-t4">
            Di norma confermano solo i collaboratori a chiamata: chi è assunto
            fisso risulta già in turno.
          </span>
        </span>
      </label>

      {/* Solo a turno concluso: prima non c'è nulla da consuntivare. */}
      {shift && isShiftOver(shift) && !cancelled ? (
        <PresenceSection
          shiftId={shift.id}
          startTime={shift.start_time}
          endTime={shift.end_time}
        />
      ) : null}

      {mutationError ? (
        <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          {mutationError.message}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button type="submit" variant="gold" disabled={pending}>
          {pending
            ? "Salvataggio…"
            : shift
              ? "Salva modifiche"
              : extraDates.length > 0
                ? `Crea ${extraDates.length + 1} turni`
                : "Crea turno"}
        </Button>
        {shift && !cancelled ? (
          <CancelShiftButton shift={shift} onDone={onClose} />
        ) : null}
      </div>
      {shift ? (
        <p className="text-[11px] leading-4 text-t4">
          Chi viene aggiunto riceve una notifica; a chi viene tolto il turno
          sparisce. Se cambi giorno o orario, gli assegnati vengono avvisati.
        </p>
      ) : null}
    </form>
  );
}
