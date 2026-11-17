import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Display } from "@/components/ui/Display";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import type { IntroSlide } from "./introContent";
import { useColors } from "@/lib/theme";

/**
 * Carosello di onboarding a schermo intero: una slide alla volta, skippabile.
 * Condiviso tra i ruoli (e, in futuro, riusabile per il "benvenuto in Pro").
 * `onDone` viene chiamato sia allo "Salta" sia all'"Inizia" finale.
 */
export function IntroCarousel({
  slides,
  onDone,
}: {
  slides: IntroSlide[];
  onDone: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <View
      className="flex-1 bg-bg-0"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
    >
      <View className="h-10 flex-row justify-end px-5">
        {!isLast ? (
          <Pressable onPress={onDone} hitSlop={8} className="justify-center">
            <Text className="font-mono text-xs uppercase tracking-widest text-t3">
              Salta
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="flex-1 items-center justify-center gap-5 px-8">
        <View className="h-24 w-24 items-center justify-center rounded-full border border-border-gold bg-bg-2">
          <Icon name={slide.icon} size={44} color={colors.gold} />
        </View>
        <Display className="text-center text-[30px] leading-9">
          {slide.title}
        </Display>
        <Text className="max-w-[320px] text-center font-sans text-base leading-7 text-t2">
          {slide.body}
        </Text>
      </View>

      <View className="gap-6 px-6">
        <View className="flex-row justify-center gap-2">
          {slides.map((_, i) => (
            <View
              key={i}
              className={cn(
                "h-1.5 rounded-full",
                i === index ? "w-6 bg-gold" : "w-1.5 bg-border-2",
              )}
            />
          ))}
        </View>
        <GoldButton
          size="lg"
          label={isLast ? "Inizia" : "Avanti"}
          onPress={() => (isLast ? onDone() : setIndex(index + 1))}
        />
      </View>
    </View>
  );
}
