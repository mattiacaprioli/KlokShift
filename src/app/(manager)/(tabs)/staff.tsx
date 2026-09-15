import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { ProBadge } from "@/features/plan/ProLock";
import { useProGate } from "@/features/plan/hooks";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useOwnerPeople } from "@/features/staff/hooks";
import {
  personEmploymentType,
  personRoleNames,
  personVenueNames,
  type OwnerPerson,
} from "@/features/staff/api";

/**
 * Una riga dell'organico: **una persona**, non una sua scheda di sede.
 *
 * Fino al 14/09/2026 questa lista mostrava le `staff_members` della sede attiva,
 * e chi lavorava in tre sedi ci compariva tre volte con un sottotitolo "anche
 * a…" a rimediare. Ora la riga è la persona (`staff_people`) e le sedi sono i
 * suoi chip: la stessa informazione, detta nel verso in cui la si pensa.
 */
function PersonRow({
  person,
  /** Le sedi in cui lavora. Vuoto con una sede sola: sarebbe rumore. */
  venueNames,
  onPress,
}: {
  person: OwnerPerson;
  venueNames: string[];
  onPress: () => void;
}) {
  const linked = !!person.waiter_id;
  const avatarUri = person.waiter?.avatar_url ?? undefined;
  // Basta un invito in sospeso in una sede qualunque: è una cosa da fare.
  const pending = person.memberships.some((m) => m.link_status === "pending");
  const employment = personEmploymentType(person);
  return (
    <Card className="rounded-3xl border-border-2 p-4" onPress={onPress}>
      <View className="flex-row items-center gap-3">
        <Avatar uri={avatarUri} name={person.full_name} size={44} />
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-base font-sans-bold text-t1">
              {person.full_name}
            </Text>
            {linked ? (
              <Icon name="verified" size={15} color="#EAB54C" />
            ) : null}
          </View>
          <Text className="text-xs text-t3">
            {personRoleNames(person) ?? "Ruoli non indicati"}
          </Text>
          {venueNames.length > 0 ? (
            <View className="mt-1.5 flex-row flex-wrap gap-1.5">
              {venueNames.map((name) => (
                <Chip key={name} label={name} />
              ))}
            </View>
          ) : null}
          {pending ? (
            <View className="mt-1 flex-row">
              <Pill label="Invito in attesa" variant="pending" />
            </View>
          ) : !linked && person.email ? (
            // Invito per email: nessun account ancora, ma l'indirizzo c'è. Si
            // vede da qui che si sta aspettando che si registri — senza dover
            // aprire la scheda per scoprirlo.
            <View className="mt-1 flex-row">
              <Pill
                label={person.invited_at ? "Invito mandato" : "Da invitare"}
                variant="pending"
              />
            </View>
          ) : null}
        </View>
        {/* Assente quando le sedi non concordano: vedi `personEmploymentType`. */}
        {employment ? (
          <Chip
            label={employment === "fisso" ? "Fisso" : "A chiamata"}
            active
            gold={employment === "fisso"}
          />
        ) : null}
        <Icon name="chevR" size={18} color="#8c857a" />
      </View>
    </Card>
  );
}

export default function ManagerStaffScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPro, gate } = useProGate();

  const venueQuery = useOwnerVenues();
  const { venues, isMultiVenue, canAny } = venueQuery;
  // Un collaboratore vede questa scheda solo per ciò che il titolare gli ha
  // dato. Nascondere i pulsanti non è la difesa — quella è la RLS
  // (`my_venue_ids('staff')`) — ma un bottone che porta a una schermata vuota è
  // peggio di un bottone che non c'è.
  const canStaff = canAny("can_manage_staff");
  const canHours = canAny("can_view_hours");
  const canVenue = canAny("can_manage_venue");
  // L'organico è dell'**azienda**: una riga per persona, tutte le sedi insieme.
  const peopleQuery = useOwnerPeople(venueQuery.ownerId);
  const people = peopleQuery.data ?? [];
  const pull = usePullToRefresh(peopleQuery.refetch);

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 96,
        gap: 16,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      }
    >
      <View>
        <Mono gold>Organico</Mono>
        <Display className="mt-1 text-4xl">Il mio staff</Display>
        {isMultiVenue && people.length > 0 ? (
          <Text className="mt-1 text-sm text-t3">
            {people.length === 1
              ? "1 persona"
              : `${people.length} persone`}{" "}
            · {venues.length} sedi
          </Text>
        ) : null}
      </View>

      {venueQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-16" />
      ) : venueQuery.isError ? (
        <QueryError className="mt-10" onRetry={() => venueQuery.refetch()} />
      ) : venues.length === 0 ? (
        <NoVenuesState subtitle="Ti serve una sede prima di creare il tuo organico." />
      ) : (
        <>
          {canStaff ? (
            <GoldButton
              label="Aggiungi allo staff"
              onPress={() => router.push("/(manager)/staff/new")}
            />
          ) : null}

          {canHours ? (
          <Card
            className="rounded-3xl border-border-2 p-4"
            onPress={gate(() => router.push("/(manager)/ore"))}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2">
                <Icon name="clock" size={18} color="#EAB54C" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-sans-bold text-t1">
                  Ore del mese
                </Text>
                <Text className="text-xs text-t3">
                  {isMultiVenue
                    ? "Ore di tutte le tue sedi, per persona"
                    : "Riepilogo ore e export per il commercialista"}
                </Text>
              </View>
              {isPro ? (
                <Icon name="chevR" size={18} color="#8c857a" />
              ) : (
                <ProBadge />
              )}
            </View>
          </Card>
          ) : null}

          {/* Non è una funzione Pro: senza ruoli non si aggiunge nemmeno una
              persona all'organico. */}
          {canVenue ? (
          <Card
            className="rounded-3xl border-border-2 p-4"
            onPress={() => router.push("/(manager)/ruoli")}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2">
                <Icon name="clipboard" size={18} color="#EAB54C" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-sans-bold text-t1">Ruoli</Text>
                <Text className="text-xs text-t3">
                  {isMultiVenue
                    ? "Le mansioni di ogni tua sede"
                    : "Le mansioni che assegni allo staff e chiedi sui turni"}
                </Text>
              </View>
              <Icon name="chevR" size={18} color="#8c857a" />
            </View>
          </Card>
          ) : null}

          {peopleQuery.isLoading ? (
            <ActivityIndicator color="#EAB54C" className="mt-6" />
          ) : peopleQuery.isError ? (
            <QueryError
              onRetry={() => peopleQuery.refetch()}
              subtitle="Non siamo riusciti a caricare l'organico. Riprova."
            />
          ) : people.length === 0 ? (
            <EmptyState
              title="Nessuno nello staff"
              subtitle="Aggiungi il tuo personale per assegnarlo ai turni."
            />
          ) : (
            <View className="gap-3">
              {people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  venueNames={isMultiVenue ? personVenueNames(person) : []}
                  onPress={() => router.push(`/(manager)/staff/${person.id}`)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
