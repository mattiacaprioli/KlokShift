import { useMemo, useState, type ReactNode } from "react";
import { userErrorMessage } from "@/lib/errors";
import { absenceForShift } from "@/features/absences/conflicts";
import { useAbsenceAvailability } from "@/features/absences/hooks";
import { absenceCellLabel } from "@/features/absences/labels";
import {
  useShiftAssignments,
  useShiftRoleRequirements,
} from "@/features/assignments/hooks";
import { computeCoverage } from "@/features/assignments/coverage";
import {
  ASSIGNMENT_STATUS_LABEL,
  isActiveAssignment,
} from "@/features/assignments/status";
import { usePendingRequestsForShift } from "@/features/changeRequests/hooks";
import { liveClockStatusIn } from "@/features/clock/live";
import { useUpdateShiftStatus } from "@/features/shifts/hooks";
import { moveImpactWindow } from "@/features/shifts/moveImpact";
import type { Shift } from "@/features/shifts/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  formatDate,
  formatShiftRange,
  formatShiftSummary,
  isShiftOver,
  shiftStartsAt,
} from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Button, Pill, Spinner } from "../ui/primitives";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { LiveClockLine } from "./LiveClockLine";
import { PresenceSection } from "./PresenceSection";

/**
 * Il turno com'è, prima di toccarlo.
 *
 * Fino al 26/09/2026 un clic su un turno apriva direttamente il form: bastava
 * un clic di troppo su un nome per togliere qualcuno dal turno e salvare senza
 * accorgersene. Ora si guarda e basta, e per cambiare qualcosa si passa da
 * «Modifica» — come nell'app, dove il dettaglio e il form sono due schermate.
 *
 * Le azioni che restano qui sono quelle che hanno già un passo esplicito
 * (annullare con conferma, ripristinare, segnare le presenze).
 */
export function ShiftDetails({
  shift,
  onEdit,
  onClose,
}: {
  shift: Shift;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { can, isMultiVenue, venueById, venues } = useOwnerVenues();
  const now = useNow();
  const assignmentsQuery = useShiftAssignments(shift.id);
  const roleReqsQuery = useShiftRoleRequirements(shift.id);
  const changeRequests = usePendingRequestsForShift(shift.id);
  // Stessa finestra del form: la query è la stessa, e passare a «Modifica» non
  // la rifà.
  const impactWindow = moveImpactWindow(shift.date);
  const absencesQuery = useAbsenceAvailability(
    impactWindow.from,
    impactWindow.to
  );

  const cancelled = shift.status === "cancelled";
  const over = isShiftOver(shift, now);
  const canManage = can(shift.venue_id, "can_manage_shifts");
  // Come nell'app: un turno finito si consuntiva (qui sotto), non si ripianifica
  // — e il form non accetta comunque una data passata. Uno annullato prima si
  // ripristina.
  const canEdit = canManage && !cancelled && !over;
  const showLiveClock =
    !cancelled &&
    now >= shiftStartsAt(shift.date, shift.start_time) &&
    !over &&
    (canManage || can(shift.venue_id, "can_view_hours"));

  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data]
  );
  const requestedByAssignment = useMemo(
    () =>
      new Map(
        (changeRequests.data ?? [])
          .filter((r) => !!r.assignment_id)
          .map((r) => [r.assignment_id as string, r.kind])
      ),
    [changeRequests.data]
  );
  const coverage = useMemo(
    () =>
      computeCoverage(
        (roleReqsQuery.data ?? []).map((r) => ({
          role_id: r.role_id,
          role: r.role?.name ?? "Ruolo",
          count: r.count,
        })),
        assignments.map((a) => ({ status: a.status, role_id: a.role_id }))
      ),
    [roleReqsQuery.data, assignments]
  );
  const workingCount = assignments.filter((a) =>
    isActiveAssignment(a.status)
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {cancelled ? (
          <div className="mb-4">
            <CancelledBanner
              shift={shift}
              canRestore={canManage}
              onDone={onClose}
            />
          </div>
        ) : null}

        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {/* Colonna sinistra: dove e quando. */}
          <div className="flex min-w-0 flex-col gap-5">
            <Info label="Quando">
              <p className="text-sm text-t1">
                {formatDate(shift.date)} ·{" "}
                {formatShiftRange(shift.start_time, shift.end_time)}
              </p>
              <p className="mt-0.5 text-xs text-t4">
                {formatShiftSummary(shift.date, shift.start_time, shift.end_time)}
              </p>
            </Info>

            {isMultiVenue ? (
              <Info label="Sede">
                <p className="text-sm text-t1">
                  {venueById(shift.venue_id)?.name ?? "—"}
                </p>
              </Info>
            ) : null}

            {shift.description ? (
              <Info label="Note">
                <p className="whitespace-pre-line text-sm leading-5 text-t2">
                  {shift.description}
                </p>
              </Info>
            ) : null}

            {shift.require_confirmation ? (
              <p className="text-xs text-t3">
                Conferma chiesta a tutti, anche a chi è assunto fisso.
              </p>
            ) : null}

            {coverage.rows.length > 0 ? (
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-t3">
                    Fabbisogno per ruolo
                  </span>
                  <Pill tone={coverage.missing > 0 ? "warning" : "success"}>
                    {coverage.covered}/{coverage.required} coperti
                  </Pill>
                </div>
                <div className="flex flex-col gap-1">
                  {coverage.rows.map((row) => {
                    const short = row.required - row.covered;
                    return (
                      <div
                        key={row.role}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
                      >
                        <span className="truncate text-sm text-t2">
                          {row.role}
                        </span>
                        {short > 0 ? (
                          <Pill tone="warning">manca {short}</Pill>
                        ) : (
                          <span className="text-xs font-semibold text-success">
                            Completo
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>

          {/* Colonna destra: chi viene. */}
          <div className="flex min-w-0 flex-col gap-5">
            <section>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
                Chi lavora ({workingCount})
              </span>
              {assignmentsQuery.isPending ? (
                <Spinner />
              ) : assignments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-2 px-3 py-4 text-center text-xs text-t4">
                  Nessuno assegnato a questo turno.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {assignments.map((a) => {
                    const works = isActiveAssignment(a.status);
                    const live = showLiveClock
                      ? liveClockStatusIn(venues, shift, a, now)
                      : null;
                    const personId = a.staff_member?.person_id;
                    const absence = personId
                      ? absenceForShift(
                          shift,
                          (absencesQuery.data ?? []).filter(
                            (x) => x.member_id === personId
                          )
                        )
                      : null;
                    const requested = requestedByAssignment.get(a.id);
                    return (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-t1">
                            {a.staff_member?.display_name ?? "—"}
                          </span>
                          <span className="block truncate text-xs text-t4">
                            {a.role?.name ?? "Ruolo da assegnare"}
                          </span>
                          {live ? <LiveClockLine status={live} /> : null}
                          {absence ? (
                            <span className="block truncate text-xs font-semibold text-warning">
                              {absenceCellLabel(absence)}
                            </span>
                          ) : null}
                          {requested ? (
                            <span className="block truncate text-xs font-semibold text-gold">
                              {requested === "hours"
                                ? "Ha chiesto un altro orario"
                                : "Ha chiesto il cambio"}{" "}
                              · rispondi in chat
                            </span>
                          ) : null}
                        </span>
                        <Pill tone={works ? "gold" : "error"}>
                          {ASSIGNMENT_STATUS_LABEL[a.status]}
                        </Pill>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Solo a turno concluso: prima non c'è nulla da consuntivare. */}
            {over && !cancelled ? (
              <PresenceSection
                shiftId={shift.id}
                venueId={shift.venue_id}
                startTime={shift.start_time}
                endTime={shift.end_time}
              />
            ) : null}
          </div>
        </div>
      </div>

      {canEdit ? (
        <footer className="flex flex-wrap gap-2 border-t border-border-2 px-6 py-4">
          <Button variant="gold" onClick={onEdit}>
            Modifica
          </Button>
          <CancelShiftButton shift={shift} onDone={onClose} />
        </footer>
      ) : null}
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-t3">
        {label}
      </span>
      {children}
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
  canRestore,
  onDone,
}: {
  shift: Shift;
  canRestore: boolean;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/40 bg-error/10 px-3 py-3">
      <p className="text-xs leading-4 text-error">
        Turno annullato. Non compare più a chi era assegnato.
      </p>
      {canRestore ? <RestoreShiftButton shift={shift} onDone={onDone} /> : null}
    </div>
  );
}
