import { Icon, type IconName } from "./Icon";
import { cn } from "@/lib/cn";
import { Pressable, Text, View } from "@/tw";

/**
 * Una riga dentro una `Card className="p-0"`: bolla icona, titolo, sottotitolo,
 * chevron. È la riga delle impostazioni; `NavRow` invece è una card intera.
 */
export function CardRow({
  icon,
  title,
  subtitle,
  divider,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Linea sopra: la riga non è la prima della card. */
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={cn(
        "flex-row items-center gap-3 px-4 py-3.5",
        divider && "border-t border-border-1"
      )}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
        <Icon name={icon} size={18} color="#EAB54C" />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-sans-semibold text-t1">{title}</Text>
        <Text className="mt-0.5 text-[13px] text-t3">{subtitle}</Text>
      </View>
      <Icon name="chevR" size={18} color="#6A6358" />
    </Pressable>
  );
}
