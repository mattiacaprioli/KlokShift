import { Pressable } from "@/tw";
import { CountBadge } from "./CountBadge";
import { Icon } from "./Icon";
import { useColors } from "@/lib/theme";

type Props = {
  count: number;
  onPress: () => void;
};

/** Campanella con badge del conteggio non letti. */
export function NotificationBell({ count, onPress }: Props) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
    >
      <Icon name="bell" size={20} color={colors.t1} />
      <CountBadge count={count} className="absolute -right-1 -top-1" />
    </Pressable>
  );
}
