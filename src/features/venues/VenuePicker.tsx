import { ScrollView, View } from "@/tw";
import { Chip } from "@/components/ui/Chip";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";
import { useOwnerVenues } from "./OwnerVenues";

/**
 * In quale sede? Il primo campo di ogni form che scrive qualcosa di una sede.
 *
 * È il posto in cui il multi-sede vive adesso: non c'è più una sede "attiva" che
 * fa da perimetro all'app: c'è un turno — o una mansione — che appartiene a una
 * sede, e lo si dice qui.
 *
 * ⚠️ **Con una sede sola non rende niente.** Chi ha un locale solo non deve
 * accorgersi che il multi-sede esiste, e un campo con un'unica scelta è rumore:
 * il chiamante ha comunque `venueId` da `useLastVenue()`, che cade su `venues[0]`.
 */
export function VenuePicker({
  value,
  onChange,
  label = "In quale sede",
  className,
}: {
  value: string | undefined;
  onChange: (venueId: string) => void;
  label?: string;
  className?: string;
}) {
  const { venues, isMultiVenue } = useOwnerVenues();
  if (!isMultiVenue) return null;

  return (
    <View className={cn("gap-2", className)}>
      <Mono gold>{label}</Mono>
      {/* Orizzontale: i nomi dei locali sono liberi e mandare a capo dei chip
          lunghi spezzerebbe la riga in modo diverso a ogni sede aggiunta. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {venues.map((v) => (
          <Chip
            key={v.id}
            label={v.name}
            gold
            active={v.id === value}
            onPress={() => onChange(v.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
