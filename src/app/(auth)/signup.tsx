import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Enums } from "@/types/database";

type Role = Enums<"user_role">;

const ROLES: {
  value: Role;
  icon: IconName;
  title: string;
  sub: string;
  chips: string[];
}[] = [
  {
    value: "waiter",
    icon: "user",
    title: "Sono un professionista",
    sub: "Sala, bar, cucina, accoglienza. Conferma i turni e costruisci la tua reputazione.",
    chips: ["TURNI", "ORE", "RECENSIONI"],
  },
  {
    value: "manager",
    icon: "users",
    title: "Gestisco una sede",
    sub: "Ristorante, hotel, catering, eventi. Organizza i turni con il tuo organico.",
    chips: ["TURNI", "STAFF", "ORE"],
  },
];

export default function SignupRole() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const choose = (role: Role) =>
    router.push({ pathname: "/(auth)/signup-account", params: { role } });

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerClassName="flex-grow px-6 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ height: insets.top + 8 }} />
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-1"
      >
        <Icon name="chevL" size={18} color="#C2BBB0" />
      </Pressable>

      <Display className="mt-6 text-[28px]">Come userai KlokShift?</Display>
      <Text className="mt-2 font-sans text-[13.5px] text-t3">
        Scegli come vuoi iniziare. Potrai cambiare in seguito dalle impostazioni.
      </Text>

      <View className="mt-7 gap-3.5">
        {ROLES.map((r) => (
          <Pressable
            key={r.value}
            onPress={() => choose(r.value)}
            className="gap-3.5 rounded-[22px] border border-border bg-bg-1 p-5"
          >
            <View className="flex-row items-center gap-3.5">
              <View className="overflow-hidden rounded-[14px] border border-border-2">
                <LinearGradient
                  colors={["#362E24", "#1F1A13"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    width: 50,
                    height: 50,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={r.icon} size={24} color="#EAB54C" />
                </LinearGradient>
              </View>
              <Text className="flex-1 font-sans-semibold text-[17px] text-t1">
                {r.title}
              </Text>
              <Icon name="chevR" size={18} color="#8C857A" />
            </View>
            <Text className="font-sans text-[12.5px] leading-5 text-t3">
              {r.sub}
            </Text>
            <View className="flex-row flex-wrap gap-1.5">
              {r.chips.map((c) => (
                <Chip key={c} label={c} />
              ))}
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable
        className="mt-8 flex-row justify-center gap-1"
        onPress={() => router.push("/(auth)/login")}
      >
        <Text className="font-sans text-sm text-t2">Hai già un account?</Text>
        <Text className="font-sans-semibold text-sm text-gold">Accedi</Text>
      </Pressable>
    </ScrollView>
  );
}
