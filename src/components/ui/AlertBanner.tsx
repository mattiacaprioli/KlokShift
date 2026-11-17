import { Icon, type IconName } from "./Icon";
import { cn } from "@/lib/cn";
import { Pressable, Text, View } from "@/tw";
import { useColors } from "@/lib/theme";

/**
 * Avviso su cui c'è qualcosa da fare: inviti in sospeso, turni da confermare.
 *
 * Fondo `bg-2` invece di `bg-card`: si stacca dalle card che gli stanno
 * intorno senza doversi prendere il gold, che in questa palette è la conferma
 * e non l'allerta.
 */
export function AlertBanner({
  icon,
  title,
  subtitle,
  onPress,
  className,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  className?: string;
}) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View
        className={cn(
          "flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-2 p-4",
          className
        )}
      >
        <Icon name={icon} size={20} color={colors.gold} />
        <View className="flex-1">
          <Text className="text-sm font-sans-bold text-t1">{title}</Text>
          {subtitle ? (
            <Text className="text-[13px] text-t2">{subtitle}</Text>
          ) : null}
        </View>
        <Icon name="chevR" size={18} color={colors.t3} />
      </View>
    </Pressable>
  );
}
