import { useState } from "react";
import {
  useSetAssignmentPresence,
  useShiftAssignments,
} from "@/features/assignments/hooks";
import { assignmentHours } from "@/features/assignments/hours";
import { useSelfStaff } from "@/features/staff/self";
import { userErrorMessage } from "@/lib/errors";
import { shiftDurationHours } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button, Input, Spinner } from "../ui/primitives";
import {
  useApproveClockRecord,
  useCorrectClockRecord,
  useVoidClockRecord,
} from "@/features/clock/hooks";
import {
  clockedHours,
  effectiveClockTimes,
  formatClockTime,
} from "@/features/clock/hours";
import type { AssignmentWithStaff } from "@/features/assignments/api";

function dateTimeLocal(value: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Converte l'orario civile italiano del campo in un istante ISO. */
function romeLocalToIso(value: string): string {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wallUtc));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const shownUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute")
  );
  return new Date(wallUtc - (shownUtc - wallUtc)).toISOString();
}

function ClockReview({
  assignment,
  locked,
}: {
  assignment: AssignmentWithStaff;
  locked: boolean;
}) {
  const clock = assignment.clock;
  const approve = useApproveClockRecord();
  const correct = useCorrectClockRecord();
  const voidClock = useVoidClockRecord();
  const [mode, setMode] = useState<"correct" | "void" | null>(null);
  const times = clock ? effectiveClockTimes(clock) : null;
  const [inAt, setInAt] = useState(() => (times ? dateTimeLocal(times.inAt) : ""));
  const [outAt, setOutAt] = useState(() =>
    times?.outAt ? dateTimeLocal(times.outAt) : ""
  );
  const [reason, setReason] = useState("");

  if (!clock || !times) {
    return <p className="mt-1 text-[11px] text-t4">Non timbrato</p>;
  }

  const hours = times.outAt ? clockedHours(times.inAt, times.outAt) : null;
  const pending = approve.isPending || correct.isPending || voidClock.isPending;
  const error = approve.error ?? correct.error ?? voidClock.error;

  function close() {
    setMode(null);
    setReason("");
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-t2">
          Timbrato {formatClockTime(times.inAt)}–{times.outAt ? formatClockTime(times.outAt) : "uscita mancante"}
          {hours != null ? ` · ${hours.toString().replace(".", ",")} h` : ""}
        </span>
        {assignment.attendance_reviewed_at ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 font-semibold text-success">
            Approvato
          </span>
        ) : (
          <span className="rounded-full bg-gold/10 px-2 py-0.5 font-semibold text-gold">
            Da verificare
          </span>
        )}
      </div>

      {!locked ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {times.outAt && !assignment.attendance_reviewed_at ? (
            <Button
              variant="gold"
              disabled={pending}
              onClick={() => approve.mutate(assignment.id)}
              className="px-3 py-1.5 text-xs"
            >
              Approva ore timbrate
            </Button>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => {
              setInAt(dateTimeLocal(times.inAt));
              setOutAt(times.outAt ? dateTimeLocal(times.outAt) : "");
              setMode("correct");
            }}
            className="px-3 py-1.5 text-xs"
          >
            {times.outAt ? "Correggi orari" : "Inserisci uscita"}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => setMode("void")}
            className="px-3 py-1.5 text-xs"
          >
            Annulla timbratura
          </Button>
        </div>
      ) : null}

      {mode === "correct" ? (
        <div className="mt-3 grid gap-2 rounded-xl bg-bg-2 p-3 sm:grid-cols-2">
          <label className="text-[11px] text-t3">
            Entrata
            <Input
              type="datetime-local"
              value={inAt}
              onChange={(event) => setInAt(event.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-[11px] text-t3">
            Uscita
            <Input
              type="datetime-local"
              value={outAt}
              onChange={(event) => setOutAt(event.target.value)}
              className="mt-1"
            />
          </label>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo della correzione"
            className="sm:col-span-2"
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={close}>Annulla</Button>
            <Button
              variant="gold"
              disabled={pending || !reason.trim() || !inAt || !outAt}
              onClick={() =>
                correct.mutate(
                  {
                    recordId: clock.id,
                    inAt: romeLocalToIso(inAt),
                    outAt: romeLocalToIso(outAt),
                    reason: reason.trim(),
                  },
                  { onSuccess: close }
                )
              }
            >
              Salva correzione
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "void" ? (
        <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-error/10 p-3">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo dell’annullamento"
            className="min-w-64 flex-1"
          />
          <Button onClick={close}>Indietro</Button>
          <Button
            variant="danger"
            disabled={pending || !reason.trim()}
            onClick={() =>
              voidClock.mutate(
                { assignmentId: assignment.id, reason: reason.trim() },
                { onSuccess: close }
              )
            }
          >
            Conferma annullamento
          </Button>
        </div>
      ) : null}

      {clock.corrections.length > 0 ? (
        <details className="mt-2 text-[11px] text-t4">
          <summary className="cursor-pointer">Storico correzioni</summary>
          <ul className="mt-1 space-y-1 pl-4">
            {clock.corrections.map((item) => (
              <li key={item.id}>
                {item.corrector?.full_name ?? "Gestore"} · {new Date(item.created_at).toLocaleString("it-IT")} · {item.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Originale: {formatClockTime(clock.clock_in_at)}–{clock.clock_out_at ? formatClockTime(clock.clock_out_at) : "uscita mancante"}
          </p>
        </details>
      ) : null}
      {error ? <p className="mt-2 text-xs text-error">{userErrorMessage(error)}</p> : null}
    </div>
  );
}

/**
 * Presenze e ore effettive di un turno concluso.
 *
 * Sta qui e non nella pagina Ore perché è qui che i dati vivono già
 * (`useShiftAssignments`): la pagina Ore aggrega per persona sul mese e non
 * conosce le singole assegnazioni. Su desktop l'ora è un campo numerico —
 * molto più veloce degli step ±0,5h dell'app.
 */
export function PresenceSection({
  shiftId,
  venueId,
  startTime,
  endTime,
}: {
  shiftId: string;
  /** La sede del turno: decide se le proprie ore sono proprie da scrivere. */
  venueId: string;
  startTime: string;
  endTime: string;
}) {
  const { data, isPending } = useShiftAssignments(shiftId);
  const presence = useSetAssignmentPresence(shiftId);
  const planned = shiftDurationHours(startTime, endTime);
  /**
   * La propria riga, per chi gestisce e lavora.
   *
   * ⚠️ Sulla riga di un **collaboratore** i controlli non vanno mostrati:
   * `freeze_assignment_payroll` congela status e `worked_hours` in silenzio, e
   * `setAssignmentPresence` fa un update senza `.select()` — il toggle
   * cambierebbe colore, la richiesta tornerebbe 200 e non salverebbe niente.
   * Il titolare invece scrive: le proprie ore non le segna nessun altro.
   */
  const self = useSelfStaff();
  const locked = !self.canEditOwnPayroll(venueId);

  // Chi ha rifiutato il turno non è una presenza da consuntivare: resta in
  // "Chi lavora" con la sua etichetta, ma qui darebbe un "Presente" verde (e un
  // tocco sul toggle ne sovrascriverebbe lo stato con `no_show`).
  const rows = (data ?? []).filter((a) => a.status !== "declined");

  if (isPending) return <Spinner label="Caricamento presenze…" />;
  if (rows.length === 0) return null;

  return (
    <section>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
        Presenze e ore
      </span>
      <div className="flex flex-col gap-1">
        {rows.map((a) => {
          const absent = a.status === "no_show";
          const hours = assignmentHours(a.status, a.worked_hours, {
            start_time: startTime,
            end_time: endTime,
          });
          // La mia riga, e non sono io a poterla consuntivare.
          const mineLocked = locked && self.isSelf(a.staff_member?.waiter_id);
          return (
            <div
              key={a.id}
              className="rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
            >
              <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-t1">
                {a.staff_member?.display_name ?? "—"}
                {self.isSelf(a.staff_member?.waiter_id) ? (
                  <span className="ml-1.5 text-xs text-gold">(tu)</span>
                ) : null}
              </span>

              {mineLocked ? (
                <>
                  <span
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-semibold",
                      absent
                        ? "border-error/40 bg-error/10 text-error"
                        : "border-success/40 bg-success/10 text-success"
                    )}
                  >
                    {absent ? "Assente" : "Presente"}
                  </span>
                  <span className="w-20 text-center font-mono text-xs text-t3">
                    {absent ? "—" : hours}
                  </span>
                </>
              ) : (
              <>
              <button
                type="button"
                onClick={() =>
                  presence.mutate({
                    id: a.id,
                    status: absent ? "confirmed" : "no_show",
                    // Rientrando da un'assenza si torna alla durata pianificata.
                    worked_hours: absent ? null : a.worked_hours,
                  })
                }
                className={cn(
                  "focus-gold rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                  absent
                    ? "border-error/40 bg-error/10 text-error"
                    : "border-success/40 bg-success/10 text-success"
                )}
              >
                {absent ? "Assente" : "Presente"}
              </button>

              <Input
                type="number"
                step={0.5}
                min={0}
                max={24}
                disabled={absent}
                value={absent ? "" : hours}
                onChange={(e) => {
                  const v = e.target.value;
                  presence.mutate({
                    id: a.id,
                    // Campo svuotato → torna alla durata pianificata (null).
                    worked_hours: v === "" ? null : Number(v),
                  });
                }}
                className="w-20 px-2 py-1 text-center font-mono text-xs disabled:opacity-40"
                aria-label="Ore effettive"
              />
              </>
              )}
              </div>
              <ClockReview assignment={a} locked={mineLocked} />
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-t4">
        Durata pianificata {planned.toString().replace(".", ",")} h. Lascia il
        campo vuoto per usarla; scrivi un numero solo se le ore sono diverse.
      </p>
      {locked && rows.some((a) => self.isSelf(a.staff_member?.waiter_id)) ? (
        <p className="mt-1 text-[11px] text-t4">
          Le tue presenze e le tue ore le segna chi ha il permesso Ore su questa
          sede.
        </p>
      ) : null}
      {presence.isError ? (
        <p className="mt-2 text-xs text-error">{userErrorMessage(presence.error)}</p>
      ) : null}
    </section>
  );
}
