import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Segmented } from "@/components/ui/Segmented";
import { ManagerShiftCard } from "@/features/shifts/ManagerShiftCard";
import { ShiftClockSummary } from "@/features/clock/ShiftClockSummary";
import {
  useOwnerPastShifts,
  useOwnerPastShiftsCount,
} from "@/features/shifts/hooks";
import {
  NO_PAST_FILTERS,
  PERIOD_PRESETS,
  activePastFilterCount,
  groupRolesByName,
  periodPresetOf,
  periodRange,
  type PastShiftStatus,
  type PastShiftsFilters,
  type PeriodPresetId,
} from "@/features/shifts/pastFilters";
import { useOwnerVenueRoles } from "@/features/roles/hooks";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { cn } from "@/lib/cn";
import { usePullToRefresh } from "@/lib/usePullToRefresh";

/** Quanto si aspetta prima di interrogare il server mentre si digita. */
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_OPTIONS: { id: PastShiftStatus; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "done", label: "Conclusi" },
  { id: "cancelled", label: "Annullati" },
];

/** Chip di filtro: acceso in oro, spento a filo di bordo. */
function FilterChip({
  label,
  active,
  onPress,
  accent,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Il colore della sede, quando il chip ne rappresenta una. */
  accent?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={active && accent ? { borderColor: accent } : undefined}
      className={cn(
        "flex-row items-center gap-2 rounded-full border px-3.5 py-2",
        active
          ? accent
            ? "bg-bg-2"
            : "border-border-gold bg-bg-2"
          : "border-border bg-transparent"
      )}
    >
      {accent ? (
        <View
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: active ? accent : "transparent",
            borderWidth: active ? 0 : 1,
            borderColor: "#8C8579",
          }}
        />
      ) : null}
      <Text
        className={cn(
          "text-[13px]",
          active ? "font-sans-semibold text-t1" : "text-t3"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Una riga di chip che scorre di lato, con il titolo sopra. */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Mono>{label}</Mono>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-5"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * Lo storico dei turni dell'azienda, filtrabile.
 *
 * Fino al 14/09/2026 era la coda dell'agenda (`(tabs)/turni`): una sezione in
 * fondo alla lista dei prossimi turni, senza filtri e con i chip di sede
 * applicati **alle righe già scaricate** — cioè un filtro che, sotto scroll
 * infinito, accorciava le pagine e troncava la lista. Cercare un turno di
 * marzo voleva dire scorrere fino a marzo.
 *
 * Qui i filtri sono parte della query (vedi `pastFilters.ts`): il conteggio in
 * cima è il totale di ciò che si sta cercando, non di quanto è a schermo.
 */
export default function ManagerHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ownerId, venues, isMultiVenue, can } = useOwnerVenues();
  const roles = groupRolesByName(useOwnerVenueRoles().data ?? []);
  const people = useOwnerPeople(ownerId).data ?? [];

  const [filters, setFilters] = useState<PastShiftsFilters>(NO_PAST_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);
  const activeCount = activePastFilterCount(filters);
  const preset = periodPresetOf(filters);

  const listQuery = useOwnerPastShifts(filters);
  const count = useOwnerPastShiftsCount(filters).data ?? 0;
  const pull = usePullToRefresh(() => listQuery.refetch());

  const [text, setText] = useState("");
  // ⚠️ Il timer dipende **solo** dal testo, e scrive con un aggiornamento
  // funzionale: mettendo `filters` fra le dipendenze, ogni pagina caricata
  // farebbe ripartire l'attesa, e chi digita piano non vedrebbe mai partire la
  // ricerca.
  useEffect(() => {
    const t = setTimeout(
      () => setFilters((f) => (f.q === text ? f : { ...f, q: text })),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [text]);

  const shifts = listQuery.data?.pages.flatMap((p) => p.rows) ?? [];

  /** Il badge di una sede, o niente se il titolare ne ha una sola. */
  const venueBadge = (venueId: string) => {
    if (!isMultiVenue) return undefined;
    const i = venues.findIndex((v) => v.id === venueId);
    if (i < 0) return undefined;
    return { name: venues[i].name, accent: venueAccent(i) };
  };

  const setPeriod = (id: PeriodPresetId) => {
    const range = periodRange(id);
    setFilters({
      ...filters,
      from: range?.from ?? null,
      to: range?.to ?? null,
    });
  };

  const reset = () => {
    setText("");
    setFilters(NO_PAST_FILTERS);
  };

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="gap-4 px-5 pb-2">
        <ScreenHeader
          eyebrow={
            activeCount > 0
              ? `${count} turni trovati`
              : `${count} turni svolti`
          }
          title="Storico"
        />

        <Input
          value={text}
          onChangeText={setText}
          placeholder="Cerca un turno…"
          returnKeyType="search"
          autoCorrect={false}
        />

        {/* Il pannello si apre solo quando serve: cinque righe di chip sopra la
            lista renderebbero lo storico una schermata di comandi. Il numero sul
            bottone dice quanti filtri sono accesi anche da chiuso. */}
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setPanelOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: panelOpen }}
            className={cn(
              "flex-row items-center gap-2 rounded-full border px-3.5 py-2",
              activeCount > 0 || panelOpen
                ? "border-border-gold bg-bg-2"
                : "border-border bg-transparent"
            )}
          >
            <Icon name="search" size={14} color="#EAB54C" />
            <Text className="text-[13px] font-sans-semibold text-t1">
              {activeCount > 0 ? `Filtri (${activeCount})` : "Filtri"}
            </Text>
          </Pressable>
          {activeCount > 0 ? (
            <Pressable onPress={reset} hitSlop={8} accessibilityRole="button">
              <Text className="text-[13px] font-sans-semibold text-gold">
                Azzera
              </Text>
            </Pressable>
          ) : null}
        </View>

        {panelOpen ? (
          <View className="gap-4">
            <ChipRow label="Periodo">
              {PERIOD_PRESETS.map((p) => (
                <FilterChip
                  key={p.id}
                  label={p.label}
                  active={preset === p.id}
                  onPress={() => setPeriod(p.id)}
                />
              ))}
            </ChipRow>

            <View className="gap-2">
              <Mono>Stato</Mono>
              <Segmented
                options={STATUS_OPTIONS}
                value={filters.status}
                onChange={(status) => setFilters({ ...filters, status })}
              />
            </View>

            {isMultiVenue ? (
              <ChipRow label="Sede">
                <FilterChip
                  label="Tutti"
                  active={!filters.venueIds}
                  onPress={() => setFilters({ ...filters, venueIds: null })}
                />
                {venues.map((v, i) => (
                  <FilterChip
                    key={v.id}
                    label={v.name}
                    accent={venueAccent(i)}
                    active={filters.venueIds?.[0] === v.id}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        venueIds:
                          filters.venueIds?.[0] === v.id ? null : [v.id],
                      })
                    }
                  />
                ))}
              </ChipRow>
            ) : null}

            {roles.length > 0 ? (
              <ChipRow label="Ruolo">
                <FilterChip
                  label="Tutti"
                  active={!filters.role}
                  onPress={() => setFilters({ ...filters, role: null })}
                />
                {roles.map((r) => (
                  <FilterChip
                    key={r.name}
                    label={r.name}
                    active={filters.role?.name === r.name}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        role: filters.role?.name === r.name ? null : r,
                      })
                    }
                  />
                ))}
              </ChipRow>
            ) : null}

            {people.length > 0 ? (
              <ChipRow label="Persona">
                <FilterChip
                  label="Tutte"
                  active={!filters.person}
                  onPress={() => setFilters({ ...filters, person: null })}
                />
                {people.map((p) => (
                  <FilterChip
                    key={p.id}
                    label={p.full_name}
                    active={filters.person?.id === p.id}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        person:
                          filters.person?.id === p.id
                            ? null
                            : { id: p.id, name: p.full_name },
                      })
                    }
                  />
                ))}
              </ChipRow>
            ) : null}
          </View>
        ) : null}
      </View>

      {listQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />
      ) : listQuery.isError ? (
        <View className="px-5">
          <QueryError
            onRetry={() => listQuery.refetch()}
            subtitle="Non siamo riusciti a caricare lo storico. Riprova."
          />
        </View>
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 32,
            gap: 12,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              tintColor="#EAB54C"
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          }
          renderItem={({ item }) => (
            <ManagerShiftCard
              shift={item}
              venue={venueBadge(item.venue_id)}
              onPress={() => router.push(`/(manager)/shift/${item.id}`)}
              // Ore e timbrature sono dati del permesso Ore, come nel planning.
              footer={
                can(item.venue_id, "can_view_hours") ? (
                  <ShiftClockSummary shift={item} />
                ) : null
              }
            />
          )}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
              listQuery.fetchNextPage();
            }
          }}
          ListEmptyComponent={
            <View className="flex-1 justify-center">
              <EmptyState
                title={
                  activeCount > 0
                    ? "Nessun turno trovato"
                    : "Nessun turno passato"
                }
                subtitle={
                  activeCount > 0
                    ? "Allarga il periodo o tocca «Azzera» per vedere tutto lo storico."
                    : "Qui finiscono i turni una volta conclusi."
                }
              />
            </View>
          }
          ListFooterComponent={
            listQuery.isFetchingNextPage ? (
              <ActivityIndicator color="#EAB54C" style={{ marginTop: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
