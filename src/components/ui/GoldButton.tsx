import { LinearGradient } from "expo-linear-gradient";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Pressable, Text } from "@/tw";
import { Animated } from "@/tw/animated";
import { cn } from "@/lib/cn";
import { FontFamily } from "@/constants/fonts";

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function GoldButton({
  label,
  onPress,
  disabled,
  size = "md",
  className,
}: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pad = size === "lg" ? 18 : size === "sm" ? 9 : 14;
  const padX = size === "sm" ? 18 : 24;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        scale.value = withTiming(0.98, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 100 });
      }}
      className={className}
    >
      <Animated.View
        style={animStyle}
        className={cn("overflow-hidden rounded-full", disabled && "opacity-50")}
      >
        <LinearGradient
          colors={["#F5C765", "#D9A23F"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{
            paddingVertical: pad,
            paddingHorizontal: padX,
            alignItems: "center",
          }}
        >
          <Text
            className={cn(
              "text-center text-gold-ink",
              size === "sm" ? "text-sm" : "text-base"
            )}
            style={{ fontFamily: FontFamily.sansSemibold }}
          >
            {label}
          </Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}
