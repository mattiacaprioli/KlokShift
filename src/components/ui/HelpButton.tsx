import { Pressable } from "@/tw";
import { Icon } from "./Icon";
import { useColors } from "@/lib/theme";

/**
 * Il «?» accanto alla campanella: Aiuto e supporto a un tocco. Prima stava in
 * Profilo › Impostazioni › Aiuto, e chi si bloccava non ci arrivava.
 */
export function HelpButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Aiuto"
      className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
    >
      <Icon name="help" size={20} color={colors.t1} />
    </Pressable>
  );
}
