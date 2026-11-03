import { Pressable, ScrollView, Text, View } from "@/tw";
import { Icon } from "@/components/ui/Icon";
import { formatDate, formatShiftRange } from "@/lib/format";
import {
  CLOCK_ATTENTION_LABEL,
  clockAttentionSummary,
  type ClockAttentionItem,
} from "./attention";

/** Riepilogo compatto del periodo: ogni anomalia porta al turno da sistemare. */
export function ClockAttentionBanner({
  items,
  onOpen,
  className,
}: {
  items: ClockAttentionItem[];
  onOpen: (item: ClockAttentionItem) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  const summary = clockAttentionSummary(items);

  return (
    <View
      className={`rounded-2xl border border-warning p-3.5 ${className ?? ""}`}
      style={{ backgroundColor: "rgba(226,146,47,0.10)" }}
    >
      <View className="flex-row items-start gap-2.5">
        <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-bg-2">
          <Icon name="alert" size={16} color="#E2922F" strokeWidth={2.2} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-sans-bold text-warning">
            Timbrature da controllare
          </Text>
          <Text className="mt-0.5 text-xs text-t2">{summary}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-3 -mr-3.5"
        contentContainerStyle={{ gap: 8, paddingRight: 14 }}
      >
        {items.map((item) => (
          <Pressable
            key={`${item.shift.id}:${item.assignmentId}`}
            onPress={() => onOpen(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.personName}, ${CLOCK_ATTENTION_LABEL[item.kind].toLowerCase()}, ${formatDate(item.shift.date)}, ${formatShiftRange(item.shift.start_time, item.shift.end_time)}`}
            className="min-w-48 rounded-xl border border-border-2 bg-bg-2 px-3 py-2.5"
          >
            <Text className="text-sm font-sans-semibold text-t1">
              {item.personName}
            </Text>
            <Text className="mt-0.5 text-xs text-warning">
              {CLOCK_ATTENTION_LABEL[item.kind]}
            </Text>
            <Text className="mt-1 text-[11px] text-t4">
              {formatDate(item.shift.date)} · {formatShiftRange(item.shift.start_time, item.shift.end_time)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
