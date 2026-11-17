import { LinearGradient } from "expo-linear-gradient";
import { View } from "@/tw";
import { Logo } from "./Logo";
import { useColors } from "@/lib/theme";
import { withAlpha } from "@/constants/colors";

type Props = {
  size?: number;
};

/** Rounded gradient badge framing the KlokShift mark, with a soft gold glow. */
export function LogoBadge({ size = 92 }: Props) {
  const colors = useColors();
  return (
    <View
      style={{
        shadowColor: colors.gold,
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 26,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: withAlpha(colors.wash, 0.12),
        }}
      >
        <LinearGradient
          colors={[colors.bg3, colors.bg1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Logo size={Math.round(size * 0.56)} />
        </LinearGradient>
      </View>
    </View>
  );
}
