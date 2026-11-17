import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { useColors } from "@/lib/theme";

type Props = {
  children: string;
  className?: string;
  fontSize?: number;
};

const SHINE_WIDTH = 120;

export function ShimmerText({ children, className, fontSize = 28 }: Props) {
  const colors = useColors();
  const translateX = useSharedValue(-SHINE_WIDTH);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(260, { duration: 2200, easing: Easing.linear }),
      -1,
      false
    );
  }, [translateX]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const textStyle = { fontSize, fontWeight: "800" as const };

  return (
    <MaskedView
      maskElement={
        <Text className={cn(className)} style={textStyle}>
          {children}
        </Text>
      }
    >
      {/* Invisible text establishes sizing */}
      <Text style={[textStyle, { opacity: 0 }]}>{children}</Text>
      <View style={StyleSheet.absoluteFill} className="bg-gold" />
      <Animated.View style={[StyleSheet.absoluteFill, animStyle]}>
        <LinearGradient
          colors={["transparent", colors.white, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: SHINE_WIDTH, height: "100%" }}
        />
      </Animated.View>
    </MaskedView>
  );
}
