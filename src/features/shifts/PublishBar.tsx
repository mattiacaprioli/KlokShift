import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { Pressable, Text, View } from "@/tw";
import { useOwnerDrafts } from "./hooks";
import { otherDrafts, publishCta, PUBLISH_CTA_HINT } from "./drafts";

/**
 * Le bozze nella tab Turni, in una riga sola. Se la settimana che si guarda ne
 * ha, è il pulsante per pubblicarle e dice quante sono. Altrimenti, se ce ne
 * sono altrove (altre settimane, o finite senza essere mai uscite), è una riga
 * discreta che porta alla prima. Prima erano due cose separate: un avviso
 * grande in cima e un «Pubblica» piccolo in mezzo a Giorni, Persone e Duplica.
 *
 * `venueIds` sono le sedi dove chi guarda può pubblicare. Gemella dell'intestazione
 * del Planning sulla dashboard: stessa regola in `otherDrafts`.
 */
export function PublishBar({
  venueIds,
  from,
  to,
  periodCount,
  onPublish,
  onOpen,
  className,
}: {
  venueIds: string[];
  /** La settimana che si sta guardando. */
  from: string;
  to: string;
  /** Le bozze pubblicabili di quella settimana. */
  periodCount: number;
  onPublish: () => void;
  onOpen: (date: string) => void;
  className?: string;
}) {
  const drafts = useOwnerDrafts();
  const other = useMemo(
    () => otherDrafts(drafts.data ?? [], { from, to, venueIds }),
    [drafts.data, from, to, venueIds]
  );

  if (periodCount > 0) {
    return (
      <View
        className={cn(
          "flex-row items-center gap-3 rounded-2xl border border-border-gold bg-bg-2 py-2.5 pl-3.5 pr-2.5",
          className
        )}
      >
        <Text className="flex-1 text-[13px] text-t2">{PUBLISH_CTA_HINT}</Text>
        <Pressable
          onPress={onPublish}
          accessibilityRole="button"
          className="rounded-full bg-gold px-3.5 py-2"
        >
          <Text className="text-[13px] font-sans-bold text-gold-ink">
            {publishCta(periodCount)}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (other.text && other.target) {
    const target = other.target;
    return (
      <Pressable
        onPress={() => onOpen(target)}
        accessibilityRole="button"
        className={cn("self-start", className)}
        hitSlop={8}
      >
        <Text className="text-[13px] text-t3">{other.text} →</Text>
      </Pressable>
    );
  }

  return null;
}
