import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { CardRow } from "@/components/ui/CardRow";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NavRow } from "@/components/ui/NavRow";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { usePendingAbsenceCount } from "@/features/absences/hooks";
import { useSwitchToWorkView } from "@/features/onboarding/useSwitchToWorkView";
import { useViewMode } from "@/features/team/ViewMode";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";
import { Pressable, ScrollView, Text, View } from "@/tw";

type Row = {
  key: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  badge?: number;
  onPress: () => void;
  /** Falso = la riga non c'è (permesso mancante): niente vicoli ciechi. */
  show?: boolean;
};

/** Un gruppo del menu: titolo e righe in una card, come le Impostazioni. */
function MenuGroup({ title, rows }: { title?: string; rows: Row[] }) {
  const visible = rows.filter((row) => row.show !== false);
  if (visible.length === 0) return null;
  return (
    <View className="gap-2">
      {title ? <SectionHeader title={title} /> : null}
      <Card className="p-0">
        {visible.map(({ key, show: _show, ...row }, i) => (
          <CardRow key={key} {...row} divider={i > 0} />
        ))}
      </Card>
    </View>
  );
}

/**
 * Tutto quello che non sta nella barra in basso: **l'azienda che gestisci**,
 * cioè dove vai per lavorare. Tu e le regole dell'azienda (profilo, password,
 * notifiche push, stato, chat fra colleghi) stanno in Impostazioni, che si
 * apre dalla card in alto, come le sezioni di Impostazioni sul web. Ogni voce
 * sta in un posto solo: le notifiche ricevute sono la campanella della Home.
 *
 * Prima del 30/10 questa tab era «Profilo» e parlava della sede; Ore, Assenze
 * e Ruoli stavano dentro Team, Collaboratori dentro Impostazioni. Le sedi ora
 * hanno la loro pagina (`(manager)/sedi`). Nascondere una riga non è la
 * difesa: è la RLS, come per la sidebar web.
 */
export default function ManagerMenuScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const { venues, isOwner, authority, workspaceName, canAny } = useOwnerVenues();
  const { canSwitch } = useViewMode();
  const workView = useSwitchToWorkView();

  const canStaff = canAny("can_manage_staff");
  const pendingAbsences = usePendingAbsenceCount(canStaff);

  const name = profile?.full_name?.trim() || session?.user.email || "";
  const roleLabel =
    authority === "owner"
      ? "Titolare"
      : authority === "collaborator"
        ? "Collaboratore"
        : null;

  return (
    <View className="flex-1 bg-bg-0">
      <View
        className="shrink-0 px-5 pb-4"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Mono>Menu</Mono>
      </View>

      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 96,
          gap: 24,
        }}
      >
        {/* Chi sei e per quale azienda: tocca per profilo e impostazioni. */}
        <Pressable
          onPress={() => router.push("/(manager)/impostazioni")}
          accessibilityRole="button"
          accessibilityLabel="Apri profilo e impostazioni"
          className="flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-card p-4"
        >
          <Avatar
            uri={profile?.avatar_url ?? undefined}
            name={name || "?"}
            size={48}
          />
          <View className="min-w-0 flex-1">
            <Text
              className="text-base font-sans-bold text-t1"
              numberOfLines={1}
            >
              {profile?.full_name?.trim() || "Aggiungi il tuo nome"}
            </Text>
            <Text className="mt-0.5 text-[13px] text-t3" numberOfLines={1}>
              {[workspaceName, roleLabel].filter(Boolean).join(" · ")}
            </Text>
            <Text className="mt-0.5 text-[13px] text-gold" numberOfLines={1}>
              Profilo e impostazioni
            </Text>
          </View>
          <Icon name="chevR" size={18} color="#8C8579" />
        </Pressable>

        {/* L'altro cappello: il Profilo del dipendente ha «Passa alla
            gestione», qui c'è il ritorno. */}
        {canSwitch ? (
          <NavRow
            icon="user"
            title="Passa ai tuoi turni"
            subtitle="I turni in cui lavori anche tu"
            onPress={() => void workView.switchToWork()}
          />
        ) : null}

        <MenuGroup
          title="Ogni giorno"
          rows={[
            {
              key: "ore",
              icon: "clock",
              title: "Ore",
              subtitle: "Ore del mese ed export per il consulente",
              onPress: () => router.push("/(manager)/ore"),
              show: canAny("can_view_hours"),
            },
            {
              key: "assenze",
              icon: "calendar",
              title: "Assenze",
              subtitle: "Ferie, permessi e malattia",
              badge: pendingAbsences,
              onPress: () => router.push("/(manager)/assenze"),
              show: canStaff,
            },
            {
              key: "storico",
              icon: "list",
              title: "Storico",
              subtitle: "I turni passati",
              onPress: () => router.push("/(manager)/storico"),
            },
          ]}
        />

        <MenuGroup
          title="Azienda"
          rows={[
            {
              key: "sedi",
              icon: "home",
              title: venues.length > 1 ? "Sedi" : "Sede",
              subtitle:
                venues.length > 1
                  ? `${venues.length} sedi`
                  : (venues[0]?.name ?? "Aggiungi la tua sede"),
              onPress: () => router.push("/(manager)/sedi"),
            },
            {
              key: "ruoli",
              icon: "clipboard",
              title: "Ruoli",
              subtitle: "Quelli che dai alle persone e chiedi sui turni",
              onPress: () => router.push("/(manager)/ruoli"),
              show: canAny("can_manage_venue"),
            },
            {
              key: "collaboratori",
              icon: "users",
              title: "Collaboratori",
              subtitle: "Chi altro gestisce le tue sedi",
              onPress: () => router.push("/(manager)/team"),
              show: isOwner,
            },
          ]}
        />

        <MenuGroup
          rows={[
            {
              key: "aiuto",
              icon: "help",
              title: "Aiuto e supporto",
              subtitle: "Guide, domande frequenti e contatti",
              onPress: () => router.push("/(manager)/aiuto"),
            },
          ]}
        />
      </ScrollView>
    </View>
  );
}
