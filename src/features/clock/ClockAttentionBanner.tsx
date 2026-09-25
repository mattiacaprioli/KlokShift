import { Pressable, ScrollView, Text, View } from "@/tw";
import { Icon } from "@/components/ui/Icon";
import { formatDate, formatTime } from "@/lib/format";
import type { ClockAttentionItem } from "./attention";
import { clockAttentionCounts } from "./attention";

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
  const counts = clockAttentionCounts(items);
  const summary = [
    counts.missingOut > 0
      ? `${counts.missingOut} ${counts.missingOut === 1 ? "uscita mancante" : "uscite mancanti"}`
      : null,
    counts.toReview > 0
      ? `${counts.toReview} da approvare`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
            accessibilityLabel={`${item.personName}, ${item.kind === "missing_out" ? "uscita mancante" : "ore da approvare"}`}
            className="min-w-48 rounded-xl border border-border-2 bg-bg-2 px-3 py-2.5"
          >
            <Text className="text-sm font-sans-semibold text-t1">
              {item.personName}
            </Text>
            <Text className="mt-0.5 text-xs text-warning">
              {item.kind === "missing_out"
                ? "Uscita mancante"
                : "Ore da approvare"}
            </Text>
            <Text className="mt-1 text-[11px] text-t4">
              {formatDate(item.shift.date)} · {formatTime(item.shift.start_time)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
