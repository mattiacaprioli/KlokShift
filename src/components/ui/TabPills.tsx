import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { cn } from "@/lib/cn";
import { Pressable, Text, View } from "@/tw";

export type TabPill<T extends string> = { id: T; label: string };

/**
 * La riga di tab a pillole delle schede lunghe (dipendente, sede): scorre in
 * orizzontale se non ci sta, e sta **fuori** dallo ScrollView del contenuto,
 * così resta ferma sotto l'intestazione.
 */
export function TabPills<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabPill<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={cn(
              "rounded-full border px-4 py-2",
              selected ? "border-gold bg-gold" : "border-border-2 bg-bg-2"
            )}
          >
            <Text
              className={cn(
                "text-sm",
                selected ? "font-sans-semibold text-gold-ink" : "text-t2"
              )}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Una sezione della scheda. Nascosta e non smontata: i form tengono gli edit
 * in stato locale, e cambiare tab non deve buttarli via. `display` in `style`
 * perché dipende dal tab scelto.
 */
export function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <View className="gap-5" style={{ display: active ? "flex" : "none" }}>
      {children}
    </View>
  );
}
