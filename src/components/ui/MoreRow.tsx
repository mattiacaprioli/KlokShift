import { Pressable, Text, View } from "@/tw";
import { Icon, type IconName } from "./Icon";
import { useColors } from "@/lib/theme";

/**
 * Una riga del pannello «Altre azioni» (il «⋯»): le azioni che servono ogni
 * tanto, fuori dalla schermata. Turni e dettaglio del turno.
 */
export function MoreRow({
  icon,
  title,
  subtitle,
  onPress,
  danger = false,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** Un'azione che toglie qualcosa (annulla, elimina): titolo e icona in rosso. */
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3.5 rounded-2xl border border-border bg-bg-2 px-4 py-3.5"
    >
      <Icon name={icon} size={20} color={danger ? colors.error : colors.t3} />
      <View className="flex-1">
        <Text
          className={
            danger ? "text-[15px] font-sans-semibold text-error" : "text-[15px] font-sans-semibold text-t1"
          }
        >
          {title}
        </Text>
        <Text className="mt-0.5 text-[13px] leading-[18px] text-t3">{subtitle}</Text>
      </View>
      <Icon name="chevR" size={16} color={colors.t3} />
    </Pressable>
  );
}
