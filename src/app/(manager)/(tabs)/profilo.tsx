import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QueryError } from "@/components/ui/QueryError";
import { cn } from "@/lib/cn";
import { PlanCard } from "@/features/plan/ProLock";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import type { Venue } from "@/features/venues/api";

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5">
      <Mono>{label}</Mono>
      <Text className="text-sm text-t2">{value}</Text>
    </View>
  );
}

/**
 * Le sedi del titolare: qui si **gestiscono** (si apre, si modifica, si aggiunge),
 * mentre lo switcher in home serve a *passare* da una all'altra.
 *
 * Sempre visibile, anche con una sede sola: è da qui che si scopre di poterne
 * aggiungere una seconda, e un titolare con tre locali non deve indovinare dove
 * andare a cercarle.
 */
function VenuesCard({
  venues,
  activeId,
  onSelect,
  onEdit,
  onAdd,
}: {
  venues: Venue[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
      <Mono>
        {venues.length === 1 ? "Il tuo locale" : `I tuoi locali · ${venues.length}`}
      </Mono>

      {venues.map((v) => {
        const active = v.id === activeId;
        return (
          <View key={v.id} className="flex-row items-center gap-2">
            {/* Toccare la riga attiva la sede; la chevron la apre in modifica.
                Due bersagli distinti perché sono due intenzioni distinte. */}
            <Pressable
              onPress={() => onSelect(v.id)}
              className={cn(
                "flex-1 flex-row items-center gap-3 rounded-2xl border px-4 py-3",
                active ? "border-gold/40 bg-gold/10" : "border-border bg-bg-1"
              )}
            >
              <Avatar uri={v.logo_url ?? undefined} name={v.name} size={32} />
              <View className="flex-1">
                <Text
                  className={cn(
                    "text-sm",
                    active
                      ? "font-sans-semibold text-gold"
                      : "font-sans-medium text-t1"
                  )}
                >
                  {v.name}
                </Text>
                {v.city ? (
                  <Text className="mt-0.5 text-xs text-t3">{v.city}</Text>
                ) : null}
              </View>
              {active ? <Icon name="check" size={16} color="#EAB54C" /> : null}
            </Pressable>
            <Pressable
              onPress={() => onEdit(v.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Modifica ${v.name}`}
              className="p-2"
            >
              <Icon name="chevR" size={18} color="#8C8579" />
            </Pressable>
          </View>
        );
      })}

      <Pressable onPress={onAdd} className="items-center pt-1">
        <Text className="text-sm font-sans-semibold text-t2">
          + Aggiungi locale
        </Text>
      </Pressable>
    </View>
  );
}

/** Barra + checklist dei campi mancanti del locale. Nascosta se la scheda è completa. */
function CompletenessCard({ venue, onEdit }: { venue: Venue; onEdit: () => void }) {
  const items = [
    { label: "Città", done: !!venue.city },
    { label: "Indirizzo", done: !!venue.address },
    { label: "Tipo di attività", done: !!venue.cuisine_type },
    { label: "Descrizione", done: !!venue.description },
  ];
  const completed = items.filter((i) => i.done).length;
  if (completed >= items.length) return null;

  return (
    <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
      <View className="flex-row items-center justify-between">
        <Mono>Completa la scheda</Mono>
        <Text className="text-sm text-t3">
          {completed}/{items.length}
        </Text>
      </View>
      <ProgressBar progress={completed / items.length} />
      <View className="gap-1">
        {items.map((item) => (
          <Pressable
            key={item.label}
            onPress={onEdit}
            className="flex-row items-center gap-3 py-1.5"
          >
            <View
              className={cn(
                "h-6 w-6 items-center justify-center rounded-full border bg-bg-2",
                item.done ? "border-gold" : "border-border-2",
              )}
            >
              {item.done ? <Icon name="check" size={14} color="#EAB54C" /> : null}
            </View>
            <Text
              className={cn("flex-1 text-sm", item.done ? "text-t3" : "text-t1")}
            >
              {item.label}
            </Text>
            {!item.done ? <Icon name="chevR" size={16} color="#5A5348" /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ManagerProfiloScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const venueQuery = useActiveVenue();
  const venue = venueQuery.venue;

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 96,
        gap: 24,
      }}
    >
      <View className="flex-row items-center justify-between">
        <Mono>Profilo · Locale</Mono>
        <Pressable
          onPress={() => router.push("/(manager)/impostazioni")}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="settings" size={19} color="#F8F4ED" />
        </Pressable>
      </View>

      {venueQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-16" />
      ) : venueQuery.isError ? (
        <QueryError className="mt-10" onRetry={() => venueQuery.refetch()} />
      ) : !venue ? (
        <View className="mt-4">
          <EmptyState
            title="Configura il tuo locale"
            subtitle="Aggiungi le informazioni del tuo locale per iniziare a pubblicare turni."
          />
          <GoldButton
            className="mt-2"
            label="Configura locale"
            onPress={() => router.push("/(manager)/venue/new")}
          />
        </View>
      ) : (
        <>
          {/* Identità locale */}
          <View className="items-center gap-4">
            <View
              className="rounded-full"
              style={{
                borderWidth: 2.5,
                borderColor: "#EAB54C",
                padding: 5,
                shadowColor: "#EAB54C",
                shadowOpacity: 0.2,
                shadowRadius: 26,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Avatar uri={venue.logo_url ?? undefined} name={venue.name} size={104} />
            </View>
            <View className="items-center gap-1.5">
              <Display className="text-4xl">{venue.name}</Display>
              {venue.city ? (
                <Text className="text-sm text-t2">{venue.city}</Text>
              ) : null}
            </View>
          </View>

          <GoldButton
            label="Modifica locale"
            onPress={() => router.push(`/(manager)/venue/${venue.id}`)}
          />

          <VenuesCard
            venues={venueQuery.venues}
            activeId={venue.id}
            onSelect={venueQuery.setActiveVenue}
            onEdit={(id) => router.push(`/(manager)/venue/${id}`)}
            onAdd={() => router.push("/(manager)/venue/new")}
          />

          <PlanCard />

          <CompletenessCard
            venue={venue}
            onEdit={() => router.push(`/(manager)/venue/${venue.id}`)}
          />

          {venue.cuisine_type || venue.address || venue.description ? (
            <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
              <Mono>Il tuo locale</Mono>
              {venue.cuisine_type ? (
                <InfoLine label="Attività" value={venue.cuisine_type} />
              ) : null}
              {venue.address ? (
                <InfoLine label="Indirizzo" value={venue.address} />
              ) : null}
              {venue.description ? (
                <Text className="text-sm leading-5 text-t2">
                  {venue.description}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
