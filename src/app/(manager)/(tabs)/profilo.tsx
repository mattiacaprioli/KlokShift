import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Display } from "@/components/ui/Display";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { QueryError } from "@/components/ui/QueryError";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { PlanCard } from "@/features/plan/ProLock";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
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
 * I locali del titolare: l'elenco da cui si aprono, si modificano, se ne
 * aggiungono.
 *
 * Non c'è più niente da "selezionare": fino al 14/09/2026 toccare una riga la
 * rendeva la sede attiva, e il resto dell'app la seguiva. Ora l'app le guarda
 * tutte insieme, quindi la riga fa una cosa sola — apre il locale. Un bersaglio
 * solo, com'era giusto fin dall'inizio.
 *
 * Sempre visibile, anche con un locale solo: è da qui che si scopre di poterne
 * aggiungere un secondo.
 */
function VenuesCard({
  venues,
  onEdit,
  /** `undefined` per un collaboratore: aprire una sede resta del titolare. */
  onAdd,
}: {
  venues: Venue[];
  onEdit: (id: string) => void;
  onAdd?: () => void;
}) {
  return (
    <View className="gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
      <Mono>
        {venues.length === 1 ? "Il tuo locale" : `I tuoi locali · ${venues.length}`}
      </Mono>

      {venues.map((v, i) => (
        <Pressable
          key={v.id}
          onPress={() => onEdit(v.id)}
          accessibilityRole="button"
          accessibilityLabel={`Apri ${v.name}`}
          className="flex-row items-center gap-3 rounded-2xl border border-border bg-bg-1 px-4 py-3"
        >
          <Avatar uri={v.logo_url ?? undefined} name={v.name} size={32} />
          <View className="flex-1">
            <Text className="text-sm font-sans-medium text-t1">{v.name}</Text>
            {v.city ? (
              <Text className="mt-0.5 text-xs text-t3">{v.city}</Text>
            ) : null}
          </View>
          {/* Lo stesso colore con cui questo locale si riconosce nell'agenda:
              è l'unico posto in cui la legenda si può imparare. */}
          {venues.length > 1 ? (
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: venueAccent(i) }}
            />
          ) : null}
          <Icon name="chevR" size={18} color="#8C8579" />
        </Pressable>
      ))}

      {onAdd ? (
        <Pressable onPress={onAdd} className="items-center pt-1">
          <Text className="text-sm font-sans-semibold text-t2">
            + Aggiungi locale
          </Text>
        </Pressable>
      ) : null}
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

/**
 * Il proprio account, in mezzo a una pagina che parla del locale.
 *
 * Sta qui perché è qui che lo si cerca: questa schermata si chiama "Profilo", e
 * chi voleva cambiare il **proprio** nome o la propria foto non trovava che il
 * logo della sede. Il gesto vero sta in `(manager)/profilo-edit`.
 */
function AccountCard({ onPress }: { onPress: () => void }) {
  const { session, profile } = useAuth();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Modifica il tuo profilo"
      className="flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-card p-5"
    >
      <Avatar
        uri={profile?.avatar_url ?? undefined}
        name={profile?.full_name ?? session?.user.email ?? "?"}
        size={44}
      />
      <View className="flex-1">
        <Mono>Il tuo account</Mono>
        <Text className="mt-1 text-[15px] font-sans-semibold text-t1">
          {profile?.full_name?.trim() || "Aggiungi il tuo nome"}
        </Text>
        <Text className="mt-0.5 text-xs text-t3">
          Nome e foto con cui ti vede il tuo staff
        </Text>
      </View>
      <Icon name="chevR" size={18} color="#8C8579" />
    </Pressable>
  );
}

export default function ManagerProfiloScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const venueQuery = useOwnerVenues();
  const { venues, isOwner } = venueQuery;
  /**
   * Con **un** locale solo il Profilo resta quello di prima: la sua identità in
   * grande, la scheda da completare, i suoi dati. Con più locali quella pagina
   * non si può scrivere — non c'è "il" locale — e il Profilo diventa l'elenco,
   * da cui si entra nella scheda della singola sede.
   */
  const venue = venues.length === 1 ? venues[0] : null;
  // I dati della sede sono un permesso a sé: un collaboratore che organizza i
  // turni non deve poter cambiare indirizzo e logo del locale.
  const canEditVenue = !!venue && venueQuery.can(venue.id, "can_manage_venue");

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

      {/* Prima del locale, e senza aspettare la query delle sedi: è l'identità
          di chi sta guardando, e non dipende da quanti locali ha. */}
      <AccountCard onPress={() => router.push("/(manager)/profilo-edit")} />

      {venueQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-16" />
      ) : venueQuery.isError ? (
        <QueryError className="mt-10" onRetry={() => venueQuery.refetch()} />
      ) : venues.length === 0 ? (
        <NoVenuesState
          className="mt-4"
          subtitle="Aggiungi le informazioni del tuo locale per iniziare a organizzare i turni."
        />
      ) : !venue ? (
        /* Più locali: l'elenco è la pagina. */
        <>
          <VenuesCard
            venues={venues}
            onEdit={(id) => router.push(`/(manager)/venue/${id}`)}
            onAdd={isOwner ? () => router.push("/(manager)/venue/new") : undefined}
          />
          {isOwner ? <PlanCard /> : null}
        </>
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

          {canEditVenue ? (
            <GoldButton
              label="Modifica locale"
              onPress={() => router.push(`/(manager)/venue/${venue.id}`)}
            />
          ) : null}

          <VenuesCard
            venues={venues}
            onEdit={(id) => router.push(`/(manager)/venue/${id}`)}
            onAdd={isOwner ? () => router.push("/(manager)/venue/new") : undefined}
          />

          {isOwner ? <PlanCard /> : null}

          {/* Una checklist che non si può spuntare è solo un elenco di cose che
              non vanno: fuori per chi non può modificare la sede. */}
          {canEditVenue ? (
            <CompletenessCard
              venue={venue}
              onEdit={() => router.push(`/(manager)/venue/${venue.id}`)}
            />
          ) : null}

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
