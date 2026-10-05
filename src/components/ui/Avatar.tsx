import { Image } from "@/tw/image";
import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { useState } from "react";

type Props = {
  uri?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
};

// Muted, desaturated earthy tones that sit well on the warm dark theme.
const COLORS = ["#6E5A3A", "#3E5B47", "#3D566E", "#5E4B6E", "#6E4A45", "#4A5A3D"];

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")) || "?";
}

function colorFor(name?: string | null) {
  if (!name) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function Avatar({ uri, name, size = 48, className }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (uri && uri !== failedUri) {
    return (
      <Image
        source={uri}
        onError={() => setFailedUri(uri)}
        recyclingKey={uri}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={className}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colorFor(name),
      }}
      className={cn("items-center justify-center", className)}
    >
      <Text className="font-sans-bold text-white" style={{ fontSize: size * 0.4 }}>
        {initials(name).toUpperCase()}
      </Text>
    </View>
  );
}
