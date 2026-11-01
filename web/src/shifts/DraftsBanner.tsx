import { useMemo } from "react";
import { useOwnerDrafts } from "@/features/shifts/hooks";
import { draftsBannerText, summarizeDrafts } from "@/features/shifts/drafts";
import { cn } from "@/lib/cn";

/**
 * L'avviso delle bozze dimenticate: «12 turni in bozza (dicembre)». Sparisce da
 * solo quando non ce ne sono. Il tocco porta al giorno della prima da pubblicare
 * (o della prima in assoluto, se restano solo quelle scadute).
 *
 * `venueIds` restringe alle sedi che chi guarda può pubblicare: senza «Turni»
 * l'avviso non porta a niente. Gemello di `src/features/shifts/DraftsBanner`.
 */
export function DraftsBanner({
  venueIds,
  onOpen,
  className,
}: {
  venueIds: string[];
  onOpen: (date: string) => void;
  className?: string;
}) {
  const drafts = useOwnerDrafts();
  const summary = useMemo(() => {
    const mine = (drafts.data ?? []).filter((d) => venueIds.includes(d.venue_id));
    return { ...summarizeDrafts(mine), fallbackDate: mine[0]?.date ?? null };
  }, [drafts.data, venueIds]);

  const text = draftsBannerText(summary);
  const target = summary.firstDate ?? summary.fallbackDate;
  if (!text || !target) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(target)}
      className={cn(
        "focus-gold mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-left transition hover:bg-gold/15 print:hidden",
        className,
      )}
    >
      <span className="text-sm font-semibold text-gold">{text}</span>
      <span aria-hidden className="text-gold">
        →
      </span>
    </button>
  );
}
