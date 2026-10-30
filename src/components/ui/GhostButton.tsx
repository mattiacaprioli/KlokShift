import { Pressable, Text } from "@/tw";
import { cn } from "@/lib/cn";

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** `sm` pareggia l'altezza di `GoldButton size="sm"` (il bordo vale 2px). */
  size?: "sm" | "md";
  className?: string;
};

/** Outlined pill button (the prototype's .btn-ghost). */
export function GhostButton({
  label,
  onPress,
  disabled,
  size = "md",
  className,
}: Props) {
  const sm = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        "items-center justify-center rounded-full border border-border-2",
        sm ? "px-4 py-2" : "px-5 py-3.5",
        disabled && "opacity-50",
        className
      )}
    >
      <Text
        className={cn(
          "text-center font-sans-medium text-t1",
          sm ? "text-sm" : "text-base"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
