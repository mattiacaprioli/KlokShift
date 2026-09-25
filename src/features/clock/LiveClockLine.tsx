import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { liveClockLabel, type LiveClockStatus } from "./live";

const TONE = {
  muted: "text-t4",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-t3",
} as const;

const DOT = {
  muted: "bg-t4",
  warning: "bg-warning",
  success: "bg-success",
  neutral: "bg-t3",
} as const;

/**
 * La timbratura del giorno sotto il nome («In servizio dalle 13:58»), con il
 * suo pallino. Stessa frase della dashboard: la dà `liveClockLabel`.
 */
export function LiveClockLine({
  status,
  onWrite,
  writing = false,
  className,
}: {
  status: LiveClockStatus;
  /** Solo per chi è in ritardo: apre la chat con la persona. */
  onWrite?: () => void;
  writing?: boolean;
  className?: string;
}) {
  const { label, tone } = liveClockLabel(status);
  return (
    <View className={cn("mt-1 flex-row items-center gap-2", className)}>
      <View className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      <Text className={cn("flex-1 text-xs font-sans-semibold", TONE[tone])}>
        {label}
      </Text>
      {status.kind === "late" && onWrite ? (
        <Pressable
          onPress={onWrite}
          disabled={writing}
          hitSlop={8}
          accessibilityRole="button"
          className="rounded-lg border border-warning/50 px-2.5 py-1"
        >
          <Text className="text-xs font-sans-semibold text-warning">
            {writing ? "Apertura…" : "Scrivi"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
