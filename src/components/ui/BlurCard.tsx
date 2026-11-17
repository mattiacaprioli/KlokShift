import { BlurView } from "expo-blur";
import React from "react";
import { View } from "@/tw";
import { cn } from "@/lib/cn";
import { useScheme } from "@/lib/theme";

type Props = {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
};

export function BlurCard({ children, className, intensity = 40 }: Props) {
  const scheme = useScheme();
  return (
    <View
      className={cn(
        "overflow-hidden rounded-2xl border border-border",
        className
      )}
    >
      <BlurView intensity={intensity} tint={scheme} style={{ padding: 16 }}>
        {children}
      </BlurView>
    </View>
  );
}
