import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { Icon } from "@/components/ui/Icon";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DeleteAccountSection } from "@/features/account/DeleteAccountSection";
import { LegalLinks } from "@/features/account/LegalLinks";
import { DevIntroReset } from "@/features/onboarding/DevIntroReset";
import { OpenWorkspaceSection } from "@/features/workspace/OpenWorkspaceSection";
import { useAuth } from "@/lib/auth";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function WaiterSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Account" title="Impostazioni" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 24,
          flexGrow: 1,
        }}
      >
        <View className="gap-2">
          <SectionHeader title="Preferenze" />
          <Card className="p-0">
            <Pressable
              onPress={() => router.push("/(waiter)/impostazioni-notifiche")}
              className="flex-row items-center gap-3 px-4 py-3.5"
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
                <Icon name="bell" size={18} color="#EAB54C" />
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-sans-semibold text-t1">
                  Notifiche
                </Text>
                <Text className="mt-0.5 text-[13px] text-t3">
                  Scegli quali notifiche push ricevere
                </Text>
              </View>
              <Icon name="chevR" size={18} color="#6A6358" />
            </Pressable>
          </Card>
        </View>

        <View className="gap-2">
          <SectionHeader title="Aiuto" />
          <Card className="p-0">
            <Pressable
              onPress={() => router.push("/(waiter)/tutorial")}
              className="flex-row items-center gap-3 px-4 py-3.5"
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
                <Icon name="calendar" size={18} color="#EAB54C" />
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-sans-semibold text-t1">
                  Ferie, permessi e malattia
                </Text>
                <Text className="mt-0.5 text-[13px] text-t3">
                  Come chiederli e cosa succede dopo
                </Text>
              </View>
              <Icon name="chevR" size={18} color="#6A6358" />
            </Pressable>
          </Card>
        </View>

        <OpenWorkspaceSection />

        <LegalLinks />

        <DevIntroReset />

        <View style={{ marginTop: "auto" }} className="gap-6">
          <GhostButton label="Esci" onPress={signOut} />
          <DeleteAccountSection />
        </View>
      </ScrollView>
    </View>
  );
}
