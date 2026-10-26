import { TableSkeleton } from "../ui/Skeleton";
import { PersonAvatar } from "../ui/PersonAvatar";
import { useState } from "react";
import {
  useSetAssignmentPresence,
  useShiftAssignments,
} from "@/features/assignments/hooks";
import { assignmentHours } from "@/features/assignments/hours";
import { useSelfStaff } from "@/features/staff/self";
import { userErrorMessage } from "@/lib/errors";
import {
  addDaysToDate,
  formatHours,
  formatHoursVariance,
  shiftCountedHours,
  type ShiftBreak,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button, Input, Select } from "../ui/primitives";
import {
  useApproveClockRecord,
  useApproveClockRecords,
  useCorrectClockBreak,
  useCorrectClockRecord,
  useEnterClockRecord,
  useVoidClockRecord,
} from "@/features/clock/hooks";
import {
  clockBreakText,
  clockRecordHours,
  effectiveClockBreak,
  effectiveClockTimes,
  formatClockTime,
  hoursAreClocked,
  isRegularPendingClock,
} from "@/features/clock/hours";
import { effectiveClockMethod } from "@/features/clock/methods";
import { isActiveAssignment } from "@/features/assignments/status";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  resolveRomeLocal,
  romeDateTimeLocal,
  romeFieldToIso,
  type RomeFieldResult,
} from "@/features/clock/timezone";
import type { AssignmentWithStaff } from "@/features/assignments/api";
import { UNPLANNED_VOID_NOTICE } from "@/features/clock/unplanned";
import { AddShiftWorker } from "./AddShiftWorker";

/**
 * Un campo data+ora della correzione, sempre nell'ora di Roma. Nell'ora che a
 * ottobre si ripete chiede quale delle due; nell'ora che a marzo non esiste dà
 * errore. Non indovina mai: un orario lavorato sbagliato di un'ora è peggio di
 * una domanda in più.
 */
export function RomeDateTimeField({
  label,
  value,
  onChange,
  choice,
  onChoice,
  result,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  choice: 0 | 1 | undefined;
  onChoice: (choice: 0 | 1 | undefined) => void;
  result: RomeFieldResult;
}) {
  const ambiguous = resolveRomeLocal(value).kind === "ambiguous";
  return (
    <label className="text-[11px] text-t3">
      {label}
      <Input
        type="datetime-local"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onChoice(undefined);
        }}
        className="mt-1"
      />
      {ambiguous && (choice !== undefined || !result.ok) ? (
        <Select
          aria-label={`${label}: quale delle due ore`}
          value={choice ?? ""}
          onChange={(event) =>
            onChoice(event.target.value === "" ? undefined : (Number(event.target.value) as 0 | 1))
          }
          className="mt-1"
        >
          <option value="">Quale delle due?</option>
          <option value="0">La prima volta (prima del cambio d’ora)</option>
          <option value="1">La seconda volta (dopo il cambio d’ora)</option>
        </Select>
      ) : null}
      {!result.ok && value ? (
        <span className="mt-1 block text-warning">{result.message}</span>
      ) : null}
    </label>
  );
}

function ClockReview({
  assignment,
  clocked,
  defaultIn,
  defaultOut,
  plannedHours,
  endTime,
  shiftBreak,
  locked,
  unplanned,
}: {
  assignment: AssignmentWithStaff;
  /**
   * Le ore passano dalla timbratura (`hoursAreClocked`): senza timbratura non
   * contano, e chi gestisce ne inserisce gli orari. Chi non timbra non ha
   * niente da mostrare qui.
   */
  clocked: boolean;
  /** Inizio e fine del turno nell'ora di Roma, proposti inserendo gli orari. */
  defaultIn: string;
  defaultOut: string;
  /** Le ore del turno: lo scostamento si legge accanto a quelle timbrate. */
  plannedHours: number;
  /** Fine prevista del turno, per proporre l'uscita mancante. */
  endTime: string;
  /** Pausa pianificata e scelta della sede, copiate sul turno. */
  shiftBreak: ShiftBreak;
  locked: boolean;
  /** Turno nato dalla timbratura: annullarla lo toglie. */
  unplanned: boolean;
}) {
  const clock = assignment.clock;
  const approve = useApproveClockRecord();
  const correct = useCorrectClockRecord();
  const correctBreak = useCorrectClockBreak();
  const voidClock = useVoidClockRecord();
  const enter = useEnterClockRecord();
  const works = isActiveAssignment(assignment.status);
  const [mode, setMode] = useState<"correct" | "void" | "enter" | null>(null);
  const times = clock ? effectiveClockTimes(clock) : null;
  const [inAt, setInAt] = useState(() => (times ? romeDateTimeLocal(times.inAt) : ""));
  const [outAt, setOutAt] = useState(() =>
    times ? outFieldDefault(times.inAt, times.outAt, endTime) : ""
  );
  const [inChoice, setInChoice] = useState<0 | 1 | undefined>();
  const [outChoice, setOutChoice] = useState<0 | 1 | undefined>();
  const [reason, setReason] = useState("");
  const pause = clock ? effectiveClockBreak(clock, shiftBreak.break_minutes) : null;
  const [breakDraft, setBreakDraft] = useState(() => String(pause?.minutes ?? 0));

  if (!clock || !times || !pause) {
    if (!clocked) return null;
    // Doveva timbrare e non l'ha fatto: senza orari quelle ore non contano. Li
    // inserisce chi ha «Ore», con un motivo, e nascono già approvati
    // (`enter_clock_record`).
    const enterIn = romeFieldToIso(inAt, { ambiguousChoice: inChoice });
    const enterOut = romeFieldToIso(outAt, { ambiguousChoice: outChoice });
    const enterRangeOk =
      enterIn.ok && enterOut.ok && Date.parse(enterOut.iso) > Date.parse(enterIn.iso);
    return (
      <div
        className="mt-2 border-t border-border pt-2"
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-t3">
            Non ha timbrato: senza orari queste ore non contano.
          </p>
          {!locked && works && mode !== "enter" ? (
            <Button
              type="button"
              variant="gold"
              onClick={() => {
                setInAt(defaultIn);
                setOutAt(defaultOut);
                setInChoice(undefined);
                setOutChoice(undefined);
                setReason("");
                setMode("enter");
              }}
              className="px-3 py-1.5 text-xs"
            >
              Inserisci orari
            </Button>
          ) : null}
        </div>
        {mode === "enter" ? (
          <div className="mt-3 grid gap-2 rounded-xl bg-bg-2 p-3 sm:grid-cols-2">
            <RomeDateTimeField
              label="Entrata"
              value={inAt}
              onChange={setInAt}
              choice={inChoice}
              onChoice={setInChoice}
              result={enterIn}
            />
            <RomeDateTimeField
              label="Uscita"
              value={outAt}
              onChange={setOutAt}
              choice={outChoice}
              onChoice={setOutChoice}
              result={enterOut}
            />
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo (facoltativo): es. non ha timbrato, mezz’ora in più"
              className="sm:col-span-2"
            />
            {enterIn.ok && enterOut.ok && !enterRangeOk ? (
              <p className="text-xs text-warning sm:col-span-2">
                L’uscita deve essere successiva all’entrata.
              </p>
            ) : null}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="button" onClick={() => setMode(null)}>
                Annulla
              </Button>
              <Button
                type="button"
                variant="gold"
                disabled={enter.isPending || !enterRangeOk}
                onClick={() => {
                  if (!enterIn.ok || !enterOut.ok) return;
                  enter.mutate(
                    {
                      assignmentId: assignment.id,
                      inAt: enterIn.iso,
                      outAt: enterOut.iso,
                      reason: reason.trim(),
                    },
                    { onSuccess: () => setMode(null) }
                  );
                }}
              >
                {enter.isPending ? "Salvataggio…" : "Salva e approva"}
              </Button>
            </div>
          </div>
        ) : null}
        {enter.error ? (
          <p className="mt-2 text-xs text-error">{userErrorMessage(enter.error)}</p>
        ) : null}
      </div>
    );
  }

  const hours = clockRecordHours(clock, shiftBreak);
  const delta = hours != null ? formatHoursVariance(hours - plannedHours) : null;
  const pauseText = clockBreakText(pause, shiftBreak.break_paid);
  const pending =
    approve.isPending || correct.isPending || correctBreak.isPending || voidClock.isPending;
  const error = approve.error ?? correct.error ?? correctBreak.error ?? voidClock.error;
  const breakValue = Number(breakDraft);
  const breakValid = breakDraft.trim() !== "" && Number.isInteger(breakValue) && breakValue >= 0;

  // Il campo non toccato salva l'istante di prima, così com'era.
  const inResult = romeFieldToIso(inAt, { originalIso: times.inAt, ambiguousChoice: inChoice });
  const outResult = romeFieldToIso(outAt, { originalIso: times.outAt, ambiguousChoice: outChoice });

  function close() {
    setMode(null);
    setReason("");
    setInChoice(undefined);
    setOutChoice(undefined);
  }

  return (
    <div
      className="mt-2 border-t border-border pt-2"
      onKeyDown={(event) => {
        // Questa UI vive dentro il form del turno, ma salva con RPC proprie.
        // Invio in un campo della correzione non deve inviare il turno padre.
        if (event.key === "Enter") event.preventDefault();
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-t2">
          Timbrato {formatClockTime(times.inAt)}–{times.outAt ? formatClockTime(times.outAt) : "uscita mancante"}
          {pauseText ? ` · ${pauseText}` : ""}
          {hours != null ? ` · ${formatHours(hours)}` : ""}
        </span>
        {delta ? (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 font-semibold text-warning">
            {delta} sul turno
          </span>
        ) : null}
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
              type="button"
              variant="gold"
              disabled={pending}
              onClick={() => approve.mutate(assignment.id)}
              className="px-3 py-1.5 text-xs"
            >
              {hours != null ? `Approva ${formatHours(hours)}` : "Approva"}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setInAt(romeDateTimeLocal(times.inAt));
              setOutAt(outFieldDefault(times.inAt, times.outAt, endTime));
              setBreakDraft(String(pause.minutes));
              setMode("correct");
            }}
            className="px-3 py-1.5 text-xs"
          >
            {times.outAt ? "Correggi orari e pausa" : "Inserisci uscita"}
          </Button>
          <Button
            type="button"
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
          <RomeDateTimeField
            label="Entrata"
            value={inAt}
            onChange={setInAt}
            choice={inChoice}
            onChoice={setInChoice}
            result={inResult}
          />
          <RomeDateTimeField
            label="Uscita"
            value={outAt}
            onChange={setOutAt}
            choice={outChoice}
            onChoice={setOutChoice}
            result={outResult}
          />
          <label className="text-[11px] text-t3">
            Pausa (minuti)
            <Input
              type="number"
              min={0}
              step={5}
              value={breakDraft}
              onChange={(event) => setBreakDraft(event.target.value)}
              className="mt-1"
            />
          </label>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo (facoltativo)"
            className="self-end"
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" onClick={close}>Annulla</Button>
            <Button
              type="button"
              variant="gold"
              disabled={
                pending || !inResult.ok || !outResult.ok || !breakValid
              }
              onClick={async () => {
                if (!inResult.ok || !outResult.ok) return;
                // Due RPC, ognuna solo se il suo dato è cambiato: una pausa
                // corretta da sola non deve riscrivere entrata e uscita.
                const timesChanged =
                  inResult.iso !== times.inAt || outResult.iso !== times.outAt;
                const breakChanged = breakValue !== pause.minutes;
                try {
                  if (timesChanged || !breakChanged) {
                    await correct.mutateAsync({
                      recordId: clock.id,
                      inAt: inResult.iso,
                      outAt: outResult.iso,
                      reason: reason.trim(),
                    });
                  }
                  if (breakChanged) {
                    await correctBreak.mutateAsync({
                      recordId: clock.id,
                      minutes: breakValue,
                      reason: reason.trim(),
                    });
                  }
                  // Correggere vuol dire aver controllato: si approva nello
                  // stesso passo, o le ore restavano fuori dal consuntivo.
                  if (works) await approve.mutateAsync(assignment.id);
                  close();
                } catch {
                  // L'errore resta nello stato della mutation e si mostra sotto.
                }
              }}
            >
              {works ? "Salva e approva" : "Salva correzione"}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "void" ? (
        <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-error/10 p-3">
          {unplanned ? (
            <p className="w-full text-xs leading-5 text-error">
              {UNPLANNED_VOID_NOTICE}
            </p>
          ) : null}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo dell’annullamento"
            className="min-w-64 flex-1"
          />
          <Button type="button" onClick={close}>Indietro</Button>
          <Button
            type="button"
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
                {item.corrector?.full_name ?? "Gestore"} · {new Date(item.created_at).toLocaleString("it-IT")}
                {item.reason ? ` · ${item.reason}` : ""}
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
/**
 * Il valore iniziale del campo «Uscita». Se manca, si propone il giorno
 * dell'entrata alla fine prevista del turno (o all'ora d'entrata, se la fine
 * cade prima): il campo vuoto costringeva a riscrivere anche la data.
 */
function outFieldDefault(
  inAt: string,
  outAt: string | null,
  endTime: string
): string {
  if (outAt) return romeDateTimeLocal(outAt);
  const entry = romeDateTimeLocal(inAt);
  const [day, entryTime] = entry.split("T");
  const end = endTime.slice(0, 5);
  return end > entryTime ? `${day}T${end}` : entry;
}

export function PresenceSection({
  shiftId,
  venueId,
  date,
  startTime,
  endTime,
  shiftBreak,
  unplanned = false,
}: {
  shiftId: string;
  /** Il giorno del turno: da qui partono gli orari proposti da inserire. */
  date: string;
  /** La sede del turno: decide se le proprie ore sono proprie da scrivere. */
  venueId: string;
  startTime: string;
  endTime: string;
  /** Pausa pianificata e scelta della sede, copiate sul turno. */
  shiftBreak: ShiftBreak;
  /** Turno nato da una timbratura senza turno. */
  unplanned?: boolean;
}) {
  const { data, isPending } = useShiftAssignments(shiftId);
  const presence = useSetAssignmentPresence(shiftId);
  const approveRegular = useApproveClockRecords();
  const planned = shiftCountedHours({
    start_time: startTime,
    end_time: endTime,
    ...shiftBreak,
  });
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
  // Con la timbratura le ore si correggono dagli orari, non dal numero: un
  // numero scritto a mano resterebbe fuori dal consuntivo (B02).
  const { venues, can, canUseOperations } = useOwnerVenues();
  // Il sostituto che nessuno aveva segnato: lo aggiunge chi ha Ore. Il fuori
  // turno è di chi ha timbrato.
  const canAddWorker = !unplanned && canUseOperations && can(venueId, "can_view_hours");
  const venueMethod = venues.find((v) => v.id === venueId)?.clock_method ?? "manual";
  const clockedOf = (a: AssignmentWithStaff) =>
    hoursAreClocked(
      a,
      effectiveClockMethod(a.staff_member?.clock_method ?? null, venueMethod)
    );
  const defaultIn = `${date}T${startTime.slice(0, 5)}`;
  const defaultOut = `${
    endTime.slice(0, 5) > startTime.slice(0, 5) ? date : addDaysToDate(date, 1)
  }T${endTime.slice(0, 5)}`;

  // Chi ha rifiutato il turno non è una presenza da consuntivare: resta in
  // "Chi lavora" con la sua etichetta, ma qui darebbe un "Presente" verde (e un
  // tocco sul toggle ne sovrascriverebbe lo stato con `no_show`).
  const rows = (data ?? []).filter((a) => a.status !== "declined");
  // La mia riga, e non sono io a poterla consuntivare.
  const isMineLocked = (a: AssignmentWithStaff) =>
    locked && self.isSelf(a.staff_member?.waiter_id);
  const times = { start_time: startTime, end_time: endTime, ...shiftBreak };
  const approvable = rows.filter(
    (a) =>
      !isMineLocked(a) &&
      a.clock != null &&
      a.attendance_reviewed_at == null &&
      effectiveClockTimes(a.clock).outAt != null
  );
  // In blocco solo chi ha fatto le ore del turno: chi si è discostato resta da
  // guardare riga per riga. Con una sola timbratura basta il suo pulsante.
  const regular = approvable.filter((a) => isRegularPendingClock(times, a));
  const showApproveRegular = regular.length > 0 && approvable.length > 1;

  if (isPending) return <TableSkeleton columns={4} rows={3} label="Caricamento presenze…" />;
  if (rows.length === 0) {
    // Nessuno risulta presente (turno rimasto scoperto, o tutti hanno
    // rifiutato): è proprio il caso in cui serve aggiungere chi è venuto.
    if (!canAddWorker) return null;
    return (
      <section>
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
          Presenze e ore
        </span>
        <p className="text-xs text-t4">Nessuno risulta presente a questo turno.</p>
        <AddShiftWorker shiftId={shiftId} venueId={venueId} assignments={data ?? []} />
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          Presenze e ore
        </span>
        {showApproveRegular ? (
          <Button
            type="button"
            variant="gold"
            disabled={approveRegular.isPending}
            onClick={() => approveRegular.mutate(regular.map((a) => a.id))}
            className="px-3 py-1.5 text-xs"
          >
            {approveRegular.isPending
              ? "Approvazione…"
              : `Approva le timbrature in orario (${regular.length})`}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((a) => {
          const absent = a.status === "no_show";
          const hours = assignmentHours(a.status, a.worked_hours, times);
          const mineLocked = isMineLocked(a);
          const clocked = clockedOf(a);
          return (
            <div
              key={a.id}
              className="rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
            >
              <div className="flex items-center gap-2">
              <PersonAvatar personId={a.staff_member?.person_id} name={a.staff_member?.display_name ?? "Professionista"} size={28} />
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
                    // Rientrando da un'assenza torna la base del turno concluso.
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

              {clocked ? (
                // Le ore vengono dalla timbratura: si correggono lì sotto.
                <span className="w-20 text-center font-mono text-xs text-t3">
                  {absent ? "—" : hours}
                </span>
              ) : (
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
                    // Campo svuotato → durata del turno come base del metodo Manuale.
                    worked_hours: v === "" ? null : Number(v),
                  });
                }}
                className="w-20 px-2 py-1 text-center font-mono text-xs disabled:opacity-40"
                aria-label="Ore effettive"
              />
              )}
              </>
              )}
              </div>
              <ClockReview
                assignment={a}
                clocked={clocked}
                defaultIn={defaultIn}
                defaultOut={defaultOut}
                plannedHours={planned}
                endTime={endTime}
                shiftBreak={shiftBreak}
                locked={mineLocked}
                unplanned={unplanned}
              />
            </div>
          );
        })}
      </div>
      {canAddWorker ? (
        <AddShiftWorker shiftId={shiftId} venueId={venueId} assignments={data ?? []} />
      ) : null}
      {rows.some((a) => !clockedOf(a)) ? (
        <p className="mt-2 text-[11px] text-t4">
          Senza timbratura, le ore del turno concluso compaiono automaticamente in Ore.
          {shiftBreak.break_minutes > 0 && !shiftBreak.break_paid
            ? ` Ore previste ${formatHours(planned)}, al netto della pausa non retribuita: correggi il numero se le ore svolte sono diverse.`
            : ` Durata prevista ${formatHours(planned)}: correggi il numero se le ore svolte sono diverse.`}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-t4">
          Con la timbratura le ore vengono dagli orari: si correggono con «Correggi
          orari e pausa» o «Inserisci orari», e si approvano nello stesso passo.
        </p>
      )}
      {locked && rows.some((a) => self.isSelf(a.staff_member?.waiter_id)) ? (
        <p className="mt-1 text-[11px] text-t4">
          Le tue presenze e le tue ore le segna chi ha il permesso Ore su questa
          sede.
        </p>
      ) : null}
      {presence.isError ? (
        <p className="mt-2 text-xs text-error">{userErrorMessage(presence.error)}</p>
      ) : null}
      {approveRegular.isError ? (
        <p className="mt-2 text-xs text-error">
          {userErrorMessage(approveRegular.error)}
        </p>
      ) : null}
    </section>
  );
}
