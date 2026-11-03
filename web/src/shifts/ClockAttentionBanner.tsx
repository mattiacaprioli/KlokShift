import { PersonAvatar } from "../ui/PersonAvatar";
import {
  CLOCK_ATTENTION_LABEL,
  clockAttentionSummary,
  type ClockAttentionItem,
} from "@/features/clock/attention";
import { formatDate, formatShiftRange } from "@/lib/format";

/** Le eccezioni del periodo, apribili senza passare in rassegna tutti i turni. */
export function ClockAttentionBanner({
  items,
  onOpen,
}: {
  items: ClockAttentionItem[];
  onOpen: (item: ClockAttentionItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-warning/50 bg-warning/10 p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-warning">
            Timbrature da controllare
          </p>
          <p className="mt-0.5 text-xs text-t2">{clockAttentionSummary(items)}</p>
        </div>
        <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
          {items.length === 1 ? "1 intervento" : `${items.length} interventi`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={`${item.shift.id}:${item.assignmentId}`}
            type="button"
            onClick={() => onOpen(item)}
            className="focus-gold rounded-xl border border-border-2 bg-bg-2 px-3 py-2 text-left transition hover:border-warning/60 hover:bg-bg-3"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-t1">
              <PersonAvatar
                personId={item.shift.shift_assignments.find(
                  (a) => a.id === item.assignmentId
                )?.staff_member?.person_id}
                name={item.personName}
                size={24}
              />
              {item.personName}
            </span>
            <span className="mt-0.5 block text-xs text-warning">
              {CLOCK_ATTENTION_LABEL[item.kind]}
            </span>
            <span className="mt-1 block text-[11px] text-t4">
              {formatDate(item.shift.date)} · {item.shift.title} ·{" "}
              {formatShiftRange(
                item.shift.start_time,
                item.shift.end_time
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
