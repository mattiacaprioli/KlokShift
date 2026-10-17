import type { StyleProp, TextStyle } from "react-native";
import { Text } from "@/tw";
import { cn } from "@/lib/cn";
import { FontFamily } from "@/constants/fonts";

type Props = {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/**
 * Serif display headline — Fraunces SemiBold with tight tracking.
 * Nest a <Text className="font-serif-italic text-gold"> inside for emphasis.
 */
export function Display({ children, className, style, numberOfLines }: Props) {
  return (
    <Text
      className={cn("text-t1", className)}
      numberOfLines={numberOfLines}
      style={[{ fontFamily: FontFamily.serifSemibold, letterSpacing: -0.5 }, style]}
    >
      {children}
    </Text>
  );
}
