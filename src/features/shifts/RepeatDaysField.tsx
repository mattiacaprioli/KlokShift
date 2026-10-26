import { Pressable, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";
import { todayString } from "@/lib/format";
import { repeatHint, shortDay, weekOf } from "./repeat";

type Props = {
  /** La data del turno ("YYYY-MM-DD"): fissa, e decide la settimana. */
  date: string;
  /** I giorni in più su cui ripeterlo. */
  extraDates: string[];
  onToggle: (day: string) => void;
};

/**
 * «Ripeti anche il…», nel form del nuovo turno: lo stesso turno su altri giorni
 * della stessa settimana. Gemello del pannello web, con le stesse regole e frasi
 * (`repeat.ts`). Solo in creazione: su un turno esistente "ripeti" vorrebbe dire
 * crearne altri, cosa diversa dal modificare questo.
 *
 * I giorni già passati non si scelgono: nell'app un turno nuovo non nasce nel
 * passato (`DayPicker` parte da oggi), e la ripetizione non deve aggirarlo.
 */
export function RepeatDaysField({ date, extraDates, onToggle }: Props) {
  const today = todayString();
  return (
    <View className="gap-2">
      <Mono>Ripeti anche il…</Mono>
      <View className="flex-row gap-1.5">
        {weekOf(date).map((day) => {
          const isMain = day === date;
          const past = day < today;
          const on = isMain || extraDates.includes(day);
          const { name, num } = shortDay(day);
          return (
            <Pressable
              key={day}
              disabled={isMain || past}
              onPress={() => onToggle(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: isMain || past }}
              accessibilityLabel={
                isMain ? `${name} ${num}, è la data del turno` : `Ripeti ${name} ${num}`
              }
              className={cn(
                "flex-1 items-center rounded-xl border py-2",
                on ? "border-border-gold bg-bg-2" : "border-border-2",
                past && "opacity-40"
              )}
            >
              <Text
                className={cn("text-[10px] uppercase", on ? "text-gold" : "text-t3")}
              >
                {name}
              </Text>
              <Text className={cn("font-mono text-xs", on ? "text-gold" : "text-t2")}>
                {num}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="text-xs text-t3">{repeatHint(extraDates.length)}</Text>
    </View>
  );
}
