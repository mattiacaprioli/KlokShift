import { LinearGradient } from "expo-linear-gradient";
import { View } from "@/tw";
import { Logo } from "./Logo";

type Props = {
  size?: number;
};

/** Rounded gradient badge framing the KlokShift mark, with a soft gold glow. */
export function LogoBadge({ size = 92 }: Props) {
  return (
    <View
      style={{
        shadowColor: "#EAB54C",
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
          borderColor: "rgba(255,240,220,0.12)",
        }}
      >
        <LinearGradient
          colors={["#362E24", "#1F1A13"]}
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
