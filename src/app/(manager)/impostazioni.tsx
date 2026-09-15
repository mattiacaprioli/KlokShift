import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { Icon } from "@/components/ui/Icon";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DeleteAccountSection } from "@/features/account/DeleteAccountSection";
import { LegalLinks } from "@/features/account/LegalLinks";
import { DevPlanToggle } from "@/features/plan/DevPlanToggle";
import { DevIntroReset } from "@/features/onboarding/DevIntroReset";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useViewMode } from "@/features/team/ViewMode";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ManagerSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, profile, signOut } = useAuth();
  const { isOwner } = useOwnerVenues();
  const { canSwitch, setMode } = useViewMode();

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
          <SectionHeader title="Account" />
          <Card className="p-0">
            {/* Il proprio nome e la propria foto, non quelli del locale: il
                Profilo parla della sede, e questa era l'unica cosa che dal
                telefono non si poteva più sistemare. */}
            <Pressable
              onPress={() => router.push("/(manager)/profilo-edit")}
              className="flex-row items-center gap-3 px-4 py-3.5"
            >
              <Avatar
                uri={profile?.avatar_url ?? undefined}
                name={profile?.full_name ?? session?.user.email ?? "?"}
                size={36}
              />
              <View className="flex-1">
                <Text className="text-[15px] font-sans-semibold text-t1">
                  {profile?.full_name?.trim() || "Il tuo profilo"}
                </Text>
                <Text className="mt-0.5 text-[13px] text-t3" numberOfLines={1}>
                  {session?.user.email ?? "Nome e foto"}
                </Text>
              </View>
              <Icon name="chevR" size={18} color="#6A6358" />
            </Pressable>

            {/* Il ritorno al proprio lato: chi è qui per una promozione
                dall'organico è prima di tutto un professionista, e i suoi turni
                stanno di là. La riga esiste solo per lui. */}
            {canSwitch ? (
              <Pressable
                onPress={() => setMode("waiter")}
                className="flex-row items-center gap-3 border-t border-border-1 px-4 py-3.5"
              >
                <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
                  <Icon name="user" size={18} color="#EAB54C" />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-sans-semibold text-t1">
                    Torna ai tuoi turni
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-t3">
                    La tua app da professionista
                  </Text>
                </View>
                <Icon name="chevR" size={18} color="#6A6358" />
              </Pressable>
            ) : null}

            {/* Solo il titolare fa entrare qualcuno nel proprio account: un
                collaboratore che potesse invitarne altri sarebbe una catena di
                deleghe senza un modello di ruoli sotto. Nascondere la riga non
                è la difesa — quella è la RLS su `venue_access`. */}
            {isOwner ? (
              <Pressable
                onPress={() => router.push("/(manager)/team")}
                className="flex-row items-center gap-3 border-t border-border-1 px-4 py-3.5"
              >
                <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
                  <Icon name="users" size={18} color="#EAB54C" />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-sans-semibold text-t1">
                    Collaboratori
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-t3">
                    Chi altro gestisce i tuoi locali, e cosa può fare
                  </Text>
                </View>
                <Icon name="chevR" size={18} color="#6A6358" />
              </Pressable>
            ) : null}
          </Card>
        </View>

        <View className="gap-2">
          <SectionHeader title="Preferenze" />
          <Card className="p-0">
            <Pressable
              onPress={() => router.push("/(manager)/impostazioni-notifiche")}
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

        <DevPlanToggle />
        <LegalLinks />

        <DevIntroReset />

        <View style={{ marginTop: "auto" }} className="gap-6">
          <GhostButton label="Esci" onPress={signOut} />
          {/* Per un professionista promosso questo è l'account con cui lavora,
              non un account da locale: cancellarlo da qui vorrebbe dire
              chiudere la propria carriera dalla porta di servizio. Lo trova
              nelle impostazioni del suo lato. */}
          {canSwitch ? null : <DeleteAccountSection />}
        </View>
      </ScrollView>
    </View>
  );
}
