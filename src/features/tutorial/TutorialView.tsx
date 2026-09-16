import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import type {
  Tutorial,
  TutorialSection,
} from "@/features/team/tutorialContent";

/** Una sezione della guida: passi numerati se hanno un ordine, punti se no. */
function Section({ section }: { section: TutorialSection }) {
  return (
    <View className="gap-2">
      <Mono>{section.title}</Mono>
      <Card className="gap-3">
        {section.steps?.map((step, i) => (
          <View key={step} className="flex-row gap-3">
            <View className="h-6 w-6 items-center justify-center rounded-full bg-gold">
              <Text className="text-[12px] font-sans-bold text-bg-0">
                {i + 1}
              </Text>
            </View>
            <Text className="flex-1 text-[14px] leading-5 text-t2">{step}</Text>
          </View>
        ))}
        {section.points?.map((point) => (
          <View key={point} className="flex-row gap-3">
            <View className="mt-2 h-1.5 w-1.5 rounded-full bg-gold" />
            <Text className="flex-1 text-[14px] leading-5 text-t2">
              {point}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

/**
 * Una guida impaginata: intestazione, introduzione, sezioni e un bottone che
 * porta dove la guida si mette in pratica.
 *
 * Condivisa dai tutorial del titolare e del professionista. I testi stanno nei
 * `tutorialContent.ts` delle feature, che li condividono con la dashboard web.
 */
export function TutorialView({
  tutorial,
  cta,
}: {
  tutorial: Tutorial;
  cta?: { label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader
          eyebrow="Tutorial"
          title={tutorial.title}
          titleClassName="text-2xl"
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
      >
        <Text className="text-[14px] leading-5 text-t3">{tutorial.intro}</Text>

        {tutorial.sections.map((section) => (
          <Section key={section.title} section={section} />
        ))}

        {cta ? <GoldButton label={cta.label} onPress={cta.onPress} /> : null}
      </ScrollView>
    </View>
  );
}
