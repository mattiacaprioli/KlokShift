import {
  clockAttentionCounts,
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
  const counts = clockAttentionCounts(items);

  return (
    <section className="mb-4 rounded-2xl border border-warning/50 bg-warning/10 p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-warning">
            Timbrature da controllare
          </p>
          <p className="mt-0.5 text-xs text-t2">
            {counts.missingOut > 0
              ? `${counts.missingOut} ${counts.missingOut === 1 ? "uscita mancante" : "uscite mancanti"}`
              : null}
            {counts.missingOut > 0 && counts.toReview > 0 ? " · " : null}
            {counts.toReview > 0
              ? `${counts.toReview} da approvare`
              : null}
          </p>
        </div>
        <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
          {counts.total === 1 ? "1 intervento" : `${counts.total} interventi`}
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
            <span className="block text-sm font-semibold text-t1">
              {item.personName}
            </span>
            <span className="mt-0.5 block text-xs text-warning">
              {item.kind === "missing_out"
                ? "Uscita mancante"
                : "Ore da approvare"}
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
