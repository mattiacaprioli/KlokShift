import { useRouter } from "expo-router";
import { Pressable, Text, View } from "@/tw";
import { LogoBadge } from "@/components/ui/LogoBadge";
import { Mono } from "@/components/ui/Mono";
import { Display } from "@/components/ui/Display";
import { GoldButton } from "@/components/ui/GoldButton";
import { FontFamily } from "@/constants/fonts";

export default function Welcome() {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center bg-bg-0 px-8">
      <LogoBadge size={92} />

      <View className="mt-12 items-center">
        <Mono gold>BENVENUTO IN KLOKSHIFT</Mono>
      </View>

      <Display
        className="mt-6 text-center text-[34px]"
        style={{ lineHeight: 40 }}
      >
        La reputazione diventa il tuo{" "}
        <Text className="text-gold" style={{ fontFamily: FontFamily.serifItalic }}>
          capitale.
        </Text>
      </Display>

      <Text className="mt-7 max-w-[320px] text-center font-sans text-base leading-7 text-t2">
        Turni sempre in tasca, ore sotto controllo e le recensioni dei clienti
        che ti seguono di sede in sede.
      </Text>

      <GoldButton
        className="mt-14 w-full max-w-[320px]"
        size="lg"
        label="Inizia"
        onPress={() => router.push("/(auth)/signup")}
      />

      <Pressable
        className="mt-6 flex-row gap-1"
        onPress={() => router.push("/(auth)/login")}
      >
        <Text className="font-sans text-sm text-t3">Ho già un account ·</Text>
        <Text className="font-sans-medium text-sm text-gold">Accedi</Text>
      </Pressable>
    </View>
  );
}
