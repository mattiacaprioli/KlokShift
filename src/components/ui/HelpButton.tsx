import { Pressable } from "@/tw";
import { Icon } from "./Icon";

/**
 * Il «?» accanto alla campanella: Aiuto e supporto a un tocco. Prima stava in
 * Profilo › Impostazioni › Aiuto, e chi si bloccava non ci arrivava.
 */
export function HelpButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Aiuto"
      className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
    >
      <Icon name="help" size={20} color="#F8F4ED" />
    </Pressable>
  );
}
