import { useEffect, useState } from "react";
import type { AbsenceAvailability } from "@/features/absences/api";
import { shiftCounts } from "@/features/assignments/coverage";
import type { ShiftWithAssignees } from "@/features/shifts/api";
import {
  moveAssignmentImpact,
  moveAssignmentLines,
} from "@/features/shifts/moveImpact";
import { formatDate, formatShiftRange } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "../ui/primitives";

/** Il turno nuovo da creare, quando nel giorno d'arrivo non c'è niente di buono. */
const NEW_SHIFT = "__new__";

/**
 * «Marco giovedì invece che mercoledì.»
 *
 * Non è un `ConfirmDialog` perché non c'è solo da confermare: nel giorno
 * d'arrivo possono esserci più turni, e quale sia quello giusto lo sa chi
 * trascina, non noi. Se non ce n'è nessuno la scelta sparisce e resta la sola
 * strada sensata — il gemello del turno di partenza — detta per esteso, così
 * che nessuno si ritrovi un turno che non ha chiesto.
 */
export function MovePersonDialog({
  who,
  from,
  assignmentId,
  toDate,
  candidates,
  absences,
  venueOf,
  pending,
  onConfirm,
  onCancel,
}: {
  who: string;
  /** Il turno da cui la persona esce. */
  from: ShiftWithAssignees;
  assignmentId: string;
  toDate: string;
  /** I turni del giorno d'arrivo dove la persona può entrare. */
  candidates: ShiftWithAssignees[];
  /** Le assenze della sola persona che si sposta. */
  absences: AbsenceAvailability[];
  venueOf: (venueId: string) => { name: string; accent: string } | undefined;
  pending?: boolean;
  onConfirm: (to: { shiftId: string } | { date: string }) => void;
  onCancel: () => void;
}) {
  // Con un turno solo è quasi sempre quello giusto: si parte da lì. Con più
  // turni non si indovina, e nemmeno si preseleziona «creane uno nuovo» —
  // sarebbe la scelta più costosa data per scontata.
  const [choice, setChoice] = useState<string>(() =>
    candidates.length === 1 ? candidates[0].id : NEW_SHIFT
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel]);

  const target = candidates.find((s) => s.id === choice) ?? null;
  const impact = moveAssignmentImpact({
    from,
    assignmentId,
    to: target ? { shift: target } : { date: toDate },
    absences,
  });
  const lines = moveAssignmentLines(impact, who, from.title, from.date);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={pending ? undefined : onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`Sposta ${who} al ${formatDate(toDate)}`}
        aria-modal
        className="relative w-full max-w-md rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-lg text-t1">
          Sposta {who} al {formatDate(toDate)}
        </h2>
        <p className="mt-2 text-sm leading-5 text-t2">
          Esce da «{from.title}» del {formatDate(from.date)}. Gli altri assegnati
          restano dove sono.
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">Dove va</legend>
          <div className="flex flex-col gap-1.5">
            {candidates.map((s) => {
              const { filled, total } = shiftCounts(s);
              const venue = venueOf(s.venue_id);
              return (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition",
                    choice === s.id
                      ? "border-border-gold bg-gold/10"
                      : "border-border-2 hover:bg-bg-2"
                  )}
                >
                  <input
                    type="radio"
                    name="move-target"
                    value={s.id}
                    checked={choice === s.id}
                    onChange={() => setChoice(s.id)}
                    className="accent-gold"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-t1">
                      {s.title}
                    </span>
                    <span className="block font-mono text-[11px] text-t3">
                      {formatShiftRange(s.start_time, s.end_time)}
                      {venue ? ` · ${venue.name}` : ""}
                    </span>
                  </span>
                  {/* Pieno non vuol dire chiuso: è un avviso, come le assenze. */}
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[11px]",
                      filled >= total ? "text-warning" : "text-t4"
                    )}
                  >
                    {filled}/{total}
                    {filled >= total ? " pieno" : ""}
                  </span>
                </label>
              );
            })}

            <label
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition",
                choice === NEW_SHIFT
                  ? "border-border-gold bg-gold/10"
                  : "border-border-2 hover:bg-bg-2"
              )}
            >
              <input
                type="radio"
                name="move-target"
                value={NEW_SHIFT}
                checked={choice === NEW_SHIFT}
                onChange={() => setChoice(NEW_SHIFT)}
                className="accent-gold"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-t1">
                  Crea un turno nuovo come «{from.title}»
                </span>
                <span className="block font-mono text-[11px] text-t3">
                  {formatShiftRange(from.start_time, from.end_time)}
                  {venueOf(from.venue_id)
                    ? ` · ${venueOf(from.venue_id)!.name}`
                    : ""}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {lines.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1 text-sm leading-5 text-t2">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="gold"
            onClick={() =>
              onConfirm(target ? { shiftId: target.id } : { date: toDate })
            }
            disabled={pending}
            autoFocus
          >
            {pending ? "Attendere…" : `Sposta ${who}`}
          </Button>
          <Button onClick={onCancel} disabled={pending}>
            Annulla
          </Button>
        </div>
      </div>
    </div>
  );
}
