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

/** Small uppercase mono chip — skills, filters, role tags (prototype's Pill). */
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
          "font-mono text-[9.5px] uppercase",
          active ? (gold ? "text-gold-ink" : "text-t1") : "text-t2"
        )}
        style={{ letterSpacing: 1.3 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
