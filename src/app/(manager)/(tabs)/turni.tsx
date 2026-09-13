import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NavRow } from "@/components/ui/NavRow";
import { QueryError } from "@/components/ui/QueryError";
import { WeekCalendar } from "@/components/ui/WeekCalendar";
import { type DaySection, groupByDay } from "@/features/assignments/agenda";
import { shiftCounts } from "@/features/assignments/coverage";
import { ManagerShiftCard } from "@/features/shifts/ManagerShiftCard";
import type { ShiftWithCount } from "@/features/shifts/types";
import { ProBadge } from "@/features/plan/ProLock";
import { useProGate } from "@/features/plan/hooks";
import { addDaysToDate, startOfWeek, todayString } from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useMyShifts, useVenuePastShifts } from "@/features/shifts/hooks";

/** Quanto ignorare il ritorno dello scorrimento dopo aver scelto un giorno. */
const SYNC_SETTLE_MS = 400;

const VIEWABILITY = { itemVisiblePercentThreshold: 20 };

type ShiftSection = DaySection<ShiftWithCount>;

/**
 * L'agenda del locale: i turni organizzati per giorno sotto un calendario.
 *
 * Stesso impianto dell'agenda del professionista, e per le stesse ragioni:
 * scegliere un giorno **fa ripartire la lista da lì** invece di farla scorrere
 * fino a lì, perché `SectionList.scrollToLocation` fallisce in silenzio (vedi
 * il commento esteso in `(waiter)/(tabs)/turni.tsx`).
 *
 * La differenza è cosa si cerca: il professionista vuole sapere quando lavora,
 * il locale vuole sapere **cosa è scoperto**. Per questo il pallino sul
 * calendario diventa arancio sui giorni con un buco, e sotto c'è il conto della
 * settimana: il quadro d'insieme senza costruire una vista di pianificazione.
 */
export default function ManagerShiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPro, gate } = useProGate();

  const venueQuery = useActiveVenue();
  const venue = venueQuery.venue;
  const upcomingQuery = useMyShifts(venue?.id);
  const pastQuery = useVenuePastShifts(venue?.id);
  const pull = usePullToRefresh(() =>
    Promise.all([upcomingQuery.refetch(), pastQuery.refetch()])
  );

  const today = todayString();
  /** Da dove parte l'agenda: lo sposta solo una scelta sul calendario. */
  const [anchorDay, setAnchorDay] = useState(today);
  /** Il giorno evidenziato: lo sposta anche lo scorrimento della lista. */
  const [visibleDay, setVisibleDay] = useState(today);
  const [expanded, setExpanded] = useState(false);

  const listRef = useRef<SectionList<ShiftWithCount, ShiftSection>>(null);
  const syncing = useRef(false);

  const upcoming = useMemo(
    () => upcomingQuery.data ?? [],
    [upcomingQuery.data]
  );
  const pastShifts = useMemo(
    () => pastQuery.data?.pages.flatMap((p) => p.rows) ?? [],
    [pastQuery.data]
  );

  // I giorni con turni e, fra questi, quelli con un buco: i due insiemi che
  // colorano i pallini del calendario.
  const { marked, alerts } = useMemo(() => {
    const m = new Set<string>();
    const a = new Set<string>();
    for (const s of upcoming) {
      m.add(s.date);
      if (s.status !== "cancelled" && shiftCounts(s).short) a.add(s.date);
    }
    return { marked: m, alerts: a };
  }, [upcoming]);

  const dayGroups = useMemo(
    () => groupByDay(upcoming, (s) => s.date),
    [upcoming]
  );

  const sections = useMemo<ShiftSection[]>(() => {
    const future = dayGroups.filter((g) => (g.date ?? "") >= anchorDay);
    // Lo storico chiude l'agenda come sezione unica: così resta virtualizzato e
    // `onEndReached` continua a paginarlo. `date: null` lo tiene fuori dalla
    // sincronia col calendario — non è un giorno, è una coda.
    if (pastShifts.length === 0) return future;
    return [...future, { date: null, title: "Storico", data: pastShifts }];
  }, [dayGroups, anchorDay, pastShifts]);

  // Il quadro della settimana di cui si sta guardando un giorno.
  const week = useMemo(() => {
    const from = startOfWeek(visibleDay);
    const to = addDaysToDate(from, 7);
    const inWeek = upcoming.filter(
      (s) => s.date >= from && s.date < to && s.status !== "cancelled"
    );
    return {
      total: inWeek.length,
      short: inWeek.filter((s) => shiftCounts(s).short).length,
    };
  }, [upcoming, visibleDay]);

  function goToDay(date: string, browsing?: boolean) {
    syncing.current = true;
    setVisibleDay(date);
    setAnchorDay(date);
    if (expanded && !browsing) setExpanded(false);
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
    setTimeout(() => {
      syncing.current = false;
    }, SYNC_SETTLE_MS);
  }

  // Identità stabile: `VirtualizedList` rifiuta un `onViewableItemsChanged`
  // che cambia fra un render e l'altro.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (syncing.current) return;
      const first = viewableItems.find(
        (v) => (v.section as ShiftSection | undefined)?.date != null
      );
      const date = (first?.section as ShiftSection | undefined)?.date;
      if (date) setVisibleDay((prev) => (prev === date ? prev : date));
    },
    []
  );

  const title = (
    <View>
      <Mono gold>Il tuo locale</Mono>
      <Display className="mt-1 text-3xl">I tuoi turni</Display>
    </View>
  );

  // Gate locale: senza venue non ha senso la lista.
  if (venueQuery.isLoading || venueQuery.isError || !venue) {
    return (
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 96,
          gap: 16,
        }}
      >
        {title}
        {venueQuery.isLoading ? (
          <ActivityIndicator color="#EAB54C" style={{ marginTop: 64 }} />
        ) : venueQuery.isError ? (
          <QueryError className="mt-10" onRetry={() => venueQuery.refetch()} />
        ) : (
          <View className="mt-6">
            <EmptyState
              title="Configura il tuo locale"
              subtitle="Ti serve un locale prima di pubblicare turni."
            />
            <GoldButton
              className="mt-2"
              label="Configura locale"
              onPress={() => router.push("/(manager)/venue/new")}
            />
          </View>
        )}
      </ScrollView>
    );
  }

  const openShift = (id: string) => router.push(`/(manager)/shift/${id}`);
  const away = anchorDay !== today;

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-5">
        <View className="flex-row items-end justify-between gap-3">
          {title}
          <View className="flex-row items-center gap-2">
            {away ? (
              <Pressable
                onPress={() => goToDay(today)}
                className="rounded-full border border-border-gold bg-bg-2 px-3 py-1.5"
                accessibilityRole="button"
              >
                <Mono gold>Oggi</Mono>
              </Pressable>
            ) : null}
            {/* Tondo e non a tutta larghezza: il bottone grande si prendeva lo
                spazio che ora serve al calendario. Porta con sé il giorno
                selezionato, così il form si apre già sulla data giusta. */}
            <Pressable
              onPress={() =>
                router.push(`/(manager)/shift/new?date=${visibleDay}`)
              }
              className="h-12 w-12 items-center justify-center rounded-full bg-gold"
              accessibilityRole="button"
              accessibilityLabel="Nuovo turno"
            >
              <Icon name="close" size={24} color="#1a1206" style={{ transform: [{ rotate: "45deg" }] }} />
            </Pressable>
          </View>
        </View>

        <WeekCalendar
          className="mt-4"
          selected={visibleDay}
          onSelect={goToDay}
          marked={marked}
          alerts={alerts}
          expanded={expanded}
          onToggleExpand={() => setExpanded((v) => !v)}
          // Il quadro della settimana, accanto al mese a cui si riferisce:
          // quando c'è un buco lo dice, altrimenti si limita a contare.
          right={
            week.short > 0 ? (
              <Text
                className="font-mono text-[10.5px] uppercase text-warning"
                style={{ letterSpacing: 1.4 }}
              >
                {week.short === 1 ? "1 scoperto" : `${week.short} scoperti`}
              </Text>
            ) : week.total > 0 ? (
              <Mono>{week.total === 1 ? "1 turno" : `${week.total} turni`}</Mono>
            ) : null
          }
        />
      </View>

      {upcomingQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />
      ) : upcomingQuery.isError ? (
        <QueryError
          onRetry={() => upcomingQuery.refetch()}
          subtitle="Non siamo riusciti a caricare i turni. Riprova."
        />
      ) : (
        <SectionList
          ref={listRef}
          style={{ flex: 1 }}
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 96,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              tintColor="#EAB54C"
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
            />
          }
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (pastQuery.hasNextPage && !pastQuery.isFetchingNextPage) {
              pastQuery.fetchNextPage();
            }
          }}
          ListHeaderComponent={
            <NavRow
              className="mb-4"
              icon="users"
              title="Copertura turni"
              subtitle="Fabbisogno per ruolo e turni scoperti"
              onPress={gate(() => router.push("/(manager)/copertura"))}
              right={isPro ? undefined : <ProBadge />}
            />
          }
          renderSectionHeader={({ section }) => (
            <View className="bg-bg-0 pb-2 pt-3">
              <Mono gold={section.date === today}>{section.title}</Mono>
            </View>
          )}
          renderItem={({ item }) => (
            <View className="pb-3">
              <ManagerShiftCard
                shift={item}
                onPress={() => openShift(item.id)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View className="flex-1 justify-center">
              <EmptyState
                title={
                  away
                    ? "Nessun turno da qui in poi"
                    : "Nessun turno in programma"
                }
                subtitle={
                  away
                    ? "Tocca «Oggi» per tornare ai prossimi, oppure «+» per crearne uno in questo giorno."
                    : "Tocca «+» per crearne uno."
                }
              />
            </View>
          }
          ListFooterComponent={
            pastQuery.isFetchingNextPage ? (
              <ActivityIndicator color="#EAB54C" style={{ marginTop: 16 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
