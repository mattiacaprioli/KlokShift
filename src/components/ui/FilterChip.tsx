import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";

/** Chip di filtro: acceso in oro, spento a filo di bordo. */
export function FilterChip({
  label,
  active,
  onPress,
  accent,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Il colore della sede, quando il chip ne rappresenta una. */
  accent?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={active && accent ? { borderColor: accent } : undefined}
      className={cn(
        "flex-row items-center gap-2 rounded-full border px-3.5 py-2",
        active
          ? accent
            ? "bg-bg-2"
            : "border-border-gold bg-bg-2"
          : "border-border bg-transparent"
      )}
    >
      {accent ? (
        <View
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: active ? accent : "transparent",
            borderWidth: active ? 0 : 1,
            borderColor: "#8C8579",
          }}
        />
      ) : null}
      <Text
        className={cn(
          "text-[13px]",
          active ? "font-sans-semibold text-t1" : "text-t3"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Una riga di chip che scorre di lato, con il titolo sopra. Esce dal margine
 * di 20 della schermata per scorrere fino al bordo.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Mono>{label}</Mono>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-5"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}
