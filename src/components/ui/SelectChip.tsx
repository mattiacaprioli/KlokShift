import { Pressable, Text } from "@/tw";
import { cn } from "@/lib/cn";

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  className?: string;
};

/**
 * Selectable pill for the shift form — role / day / badge filters.
 * Flat gold fill when active, hairline outline otherwise. Testo normale dal
 * 15/11, come le altre chip.
 */
export function SelectChip({ label, active, onPress, className }: Props) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "rounded-full border px-5 py-3",
        active ? "border-gold bg-gold" : "border-border-2 bg-transparent",
        className
      )}
    >
      <Text
        className={cn(
          "text-sm font-sans-medium",
          active ? "text-gold-ink" : "text-t2"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
