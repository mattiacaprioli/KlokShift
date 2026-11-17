import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";
import { useColors } from "@/lib/theme";
import { withAlpha, type ThemeColors } from "@/constants/colors";

type Variant =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "open"
  | "closed"
  | "neutral"
  | "tag";

type Props = {
  label: string;
  variant?: Variant;
  /** Optional leading line-icon, tinted to the pill's text color. */
  icon?: IconName;
  className?: string;
};

const pillStyles = (
  colors: ThemeColors,
): Record<Variant, { bg: string; text: string; border?: string }> => ({
  pending: { bg: withAlpha(colors.warning, 0.15), text: colors.warning },
  accepted: { bg: withAlpha(colors.success, 0.15), text: colors.success },
  rejected: { bg: withAlpha(colors.error, 0.15), text: colors.error },
  cancelled: { bg: withAlpha(colors.t3, 0.2), text: colors.t2 },
  open: { bg: withAlpha(colors.success, 0.15), text: colors.success },
  closed: { bg: withAlpha(colors.t3, 0.2), text: colors.t2 },
  neutral: { bg: withAlpha(colors.wash, 0.06), text: colors.t2 },
  // Outlined gold chip — e.g. shift requirements ("✓ VELOCE").
  tag: { bg: "transparent", text: colors.gold, border: withAlpha(colors.gold, 0.4) },
});

export function Pill({ label, variant = "neutral", icon, className }: Props) {
  const s = pillStyles(useColors())[variant];
  return (
    <View
      style={{
        backgroundColor: s.bg,
        borderWidth: s.border ? 1 : 0,
        borderColor: s.border,
      }}
      className={cn(
        "flex-row items-center gap-1 self-start rounded-full px-3 py-1",
        className
      )}
    >
      {icon ? (
        <Icon name={icon} size={12} color={s.text} strokeWidth={2.4} />
      ) : null}
      <Text style={{ color: s.text }} className="text-xs font-sans-semibold">
        {label}
      </Text>
    </View>
  );
}
