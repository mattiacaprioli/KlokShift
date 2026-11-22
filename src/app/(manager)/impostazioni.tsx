import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { GhostButton } from "@/components/ui/GhostButton";
import { CardRow } from "@/components/ui/CardRow";
import { Icon } from "@/components/ui/Icon";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DeleteAccountSection } from "@/features/account/DeleteAccountSection";
import { LegalLinks } from "@/features/account/LegalLinks";
import { DevIntroReset } from "@/features/onboarding/DevIntroReset";
import { useAuth } from "@/lib/auth";
import { StaffChatToggle } from "@/features/chat/StaffChatToggle";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useViewMode } from "@/features/team/ViewMode";
import { showSwitchToWork } from "@/features/team/viewModeLogic";
import { CollaboratorPermissionsCard } from "@/features/team/CollaboratorPermissionsCard";
import { WorkspaceAccessCard } from "@/features/workspace/WorkspaceAccessCard";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { RefreshControl } from "react-native";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemeSection } from "@/features/appearance/ThemeSection";
import { useColors } from "@/lib/theme";

/**
 * Tu e le regole dell'azienda, nelle stesse sezioni di Impostazioni sul web
 * (Profilo · I tuoi permessi · Sicurezza · Notifiche · Aspetto · Azienda · Legale).
 *
 * Dove si va per lavorare (Collaboratori, Aiuto, «Passa ai tuoi turni») sta
 * nel Menu, da cui si arriva qui: fino al 30/10 erano in tutte e due le
 * schermate, e non si capiva quale fosse quella giusta.
 */
export default function ManagerSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, profile, signOut } = useAuth();
  const { isOwner, workspaceId, memberships, refetch } = useOwnerVenues();
  // Lo stato dell'azienda si ricarica trascinando in giù (non c'è più un
  // «Aggiorna» nella sua card, vedi `WorkspaceAccessCard`).
  const pull = usePullToRefresh(() => refetch());
  const { canSwitch } = useViewMode();
  const switchToWork = showSwitchToWork({
    canSwitch,
    isOwner,
    workspaceId,
    memberships,
  });

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Account" title="Impostazioni" />
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            tintColor={colors.gold}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + 24,
          gap: 24,
          flexGrow: 1,
        }}
      >
        <View className="gap-2">
          <SectionHeader title="Profilo" />
          <Card className="p-0">
            {/* Il proprio nome e la propria foto, non quelli della sede. */}
            <Pressable
              onPress={() => router.push("/(manager)/profilo-edit")}
              accessibilityRole="button"
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
              <Icon name="chevR" size={18} color={colors.t4} />
            </Pressable>
          </Card>
        </View>

        {/* Il benvenuto della Home, da ritrovare dopo averlo chiuso. Solo per
            il collaboratore: per gli altri non c'è. */}
        <CollaboratorPermissionsCard variant="settings" />

        <View className="gap-2">
          <SectionHeader title="Sicurezza" />
          <Card className="p-0">
            <CardRow
              icon="lock"
              title="Cambia password"
              subtitle="Vale anche per la dashboard web"
              onPress={() => router.push("/(manager)/cambia-password")}
            />
          </Card>
        </View>

        <View className="gap-2">
          <SectionHeader title="Notifiche" />
          <Card className="p-0">
            <CardRow
              icon="bell"
              title="Notifiche push"
              subtitle="Scegli quali ricevere sul telefono"
              onPress={() => router.push("/(manager)/impostazioni-notifiche")}
            />
          </Card>
        </View>

        <ThemeSection />

        {/* Le regole dell'azienda sono di chi la guida: stato e chat fra
            colleghi, come la sezione Azienda sul web. */}
        {isOwner && workspaceId ? (
          <View className="gap-2">
            <SectionHeader title="Azienda" />
            <View className="gap-3">
              <WorkspaceAccessCard />
              <StaffChatToggle workspaceId={workspaceId} />
            </View>
          </View>
        ) : null}

        <LegalLinks />

        <DevIntroReset />

        <View style={{ marginTop: "auto" }} className="gap-6">
          <GhostButton label="Esci" onPress={signOut} />
          {/* Per un dipendente promosso questo è l'account con cui lavora,
              non un account da sede: cancellarlo da qui vorrebbe dire
              chiudere la propria carriera dalla porta di servizio. Lo trova
              nelle impostazioni del suo lato. Se quel lato dal Menu non si
              raggiunge (`showSwitchToWork`), resta qui. */}
          {switchToWork ? null : <DeleteAccountSection />}
        </View>
      </ScrollView>
    </View>
  );
}
