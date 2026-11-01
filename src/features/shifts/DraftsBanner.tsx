import { useMemo } from "react";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { useOwnerDrafts } from "./hooks";
import { draftsBannerText, summarizeDrafts } from "./drafts";

/**
 * L'avviso delle bozze dimenticate: «12 turni in bozza (dicembre)». Sparisce
 * da solo quando non ce ne sono. Il tocco porta al giorno della prima da
 * pubblicare (o della prima in assoluto, se restano solo quelle scadute).
 *
 * `venueIds` restringe alle sedi che chi guarda può pubblicare: senza «Turni»
 * l'avviso non porta a niente.
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
    const sum = summarizeDrafts(mine);
    return { ...sum, fallbackDate: mine[0]?.date ?? null };
  }, [drafts.data, venueIds]);

  const text = draftsBannerText(summary);
  const target = summary.firstDate ?? summary.fallbackDate;
  if (!text || !target) return null;

  return (
    <AlertBanner
      icon="calendar"
      title={text}
      className={className}
      onPress={() => onOpen(target)}
    />
  );
}
