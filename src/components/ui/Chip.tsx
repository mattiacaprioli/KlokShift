import { Pressable, Text } from "@/tw";
import { cn } from "@/lib/cn";

type Props = {
  label: string;
  active?: boolean;
  /** Gold fill when active (otherwise a neutral tint). */
  gold?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  className?: string;
  /** Per le chip di una lettera (L, M, M…): cosa legge lo screen reader. */
  accessibilityLabel?: string;
};

/**
 * Piccola chip — filtri, sedi, ruoli. In maiuscole e minuscole normali dal
 * 15/11: il mono maiuscolo spaziato la faceva pesare più del dato accanto.
 */
export function Chip({
  label,
  active,
  gold,
  onPress,
  onLongPress,
  className,
  accessibilityLabel,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={onPress ? { selected: !!active } : undefined}
      className={cn(
        "self-start rounded-full border px-2.5 py-1.5",
        active
          ? gold
            ? "border-gold bg-gold"
            : "border-border-2 bg-white/10"
          : "border-border bg-transparent",
        className
      )}
    >
      <Text
        className={cn(
          "text-xs font-sans-medium",
          active ? (gold ? "text-gold-ink" : "text-t1") : "text-t2"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
