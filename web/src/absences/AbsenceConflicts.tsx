import { useNavigate } from "react-router-dom";
import type { AbsenceWindow } from "@/features/absences/conflicts";
import {
  useAbsenceConflicts,
  useRemoveFromShifts,
} from "@/features/absences/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { userErrorMessage } from "@/lib/errors";
import { formatDate, formatShiftRange } from "@/lib/format";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/primitives";

type Conflict = ReturnType<typeof useAbsenceConflicts>["conflicts"][number];

/** I turni in conflitto, ognuno apribile nel pannello del Planning. */
export function ConflictShiftList({ shifts }: { shifts: Conflict[] }) {
  const navigate = useNavigate();
  const { venues, isMultiVenue } = useOwnerVenues();
  return (
    <ul className="flex flex-col gap-1">
      {shifts.map((s) => {
        const venue = isMultiVenue
          ? venues.find((v) => v.id === s.venue_id)?.name
          : null;
        return (
          <li key={s.assignmentId}>
            <button
              type="button"
              onClick={() => navigate(`/planning?shift=${s.id}`)}
              className="focus-gold text-left text-xs text-t2 underline-offset-2 hover:text-gold hover:underline"
            >
              {formatDate(s.date)} · {formatShiftRange(s.start_time, s.end_time)}{" "}
              · {[s.title, venue].filter(Boolean).join(" · ")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * I turni che un'assenza **già approvata** lascia scoperti, con «Togli dai
 * turni». Gemello app in `src/features/absences/AbsenceConflicts.tsx`.
 */
export function AbsenceConflictsBlock({
  absence,
}: {
  absence: AbsenceWindow & { person_id: string };
}) {
  const toast = useToast();
  const { conflicts, isLoading } = useAbsenceConflicts(
    absence,
    absence.status === "approved"
  );
  const remove = useRemoveFromShifts();

  if (absence.status !== "approved" || isLoading || conflicts.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
      <p className="text-xs font-semibold text-warning">
        {conflicts.length === 1
          ? "È ancora in turno in quei giorni"
          : `È ancora in ${conflicts.length} turni in quei giorni`}
      </p>
      <ConflictShiftList shifts={conflicts} />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              conflicts.map((c) => c.assignmentId),
              {
                onSuccess: () => toast.show("Tolto dai turni: ora sono scoperti"),
                onError: (e) =>
                  toast.show(userErrorMessage(e, "Operazione non riuscita"), "error"),
              }
            )
          }
        >
          Togli dai turni
        </Button>
        <span className="text-xs text-t4">
          Il turno resta, scoperto: chi viene tolto riceve «Turno revocato».
        </span>
      </div>
    </div>
  );
}
