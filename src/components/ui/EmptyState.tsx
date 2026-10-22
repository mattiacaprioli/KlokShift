import React from "react";
import { Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";

type Props = {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
  /** Il passo successivo: uno stato vuoto dovrebbe dire anche cosa fare. */
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: "gold" | "ghost";
};

export function EmptyState({
  icon,
  title,
  subtitle,
  className,
  actionLabel,
  onAction,
  actionVariant = "gold",
}: Props) {
  return (
    <View className={cn("items-center justify-center px-6 py-12", className)}>
      {icon}
      <Text className="mt-4 text-center text-base font-sans-semibold text-t1">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-1 text-center text-sm text-t3">{subtitle}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-5">
          {actionVariant === "gold" ? (
            <GoldButton size="sm" label={actionLabel} onPress={onAction} />
          ) : (
            <GhostButton size="sm" label={actionLabel} onPress={onAction} />
          )}
        </View>
      ) : null}
    </View>
  );
}
