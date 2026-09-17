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
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { WeekCalendar } from "@/components/ui/WeekCalendar";
import { type DaySection, groupByDay } from "@/features/assignments/agenda";
import { PeopleWeekList } from "@/features/assignments/PeopleWeekList";
import { shiftCounts } from "@/features/assignments/coverage";
import { ManagerShiftCard } from "@/features/shifts/ManagerShiftCard";
import type { ShiftWithCount } from "@/features/shifts/types";
import { cn } from "@/lib/cn";
import { addDaysToDate, startOfWeek, todayString } from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { useOwnerShifts } from "@/features/shifts/hooks";
import { useSelfStaff } from "@/features/staff/self";

/** Quanto ignorare il ritorno dello scorrimento dopo aver scelto un giorno. */
const SYNC_SETTLE_MS = 400;

const VIEWABILITY = { itemVisiblePercentThreshold: 20 };

type ShiftSection = DaySection<ShiftWithCount>;

/** Un turno da coprire: manca qualcuno e non è stato annullato. */
function isShort(shift: ShiftWithCount): boolean {
  return shift.status !== "cancelled" && shiftCounts(shift).short;
}

/**
 * L'agenda dell'azienda: i turni organizzati per giorno sotto un calendario.
 *
 * Dal 14/09/2026 mostra **tutte le sedi insieme**. Non è un dettaglio di
 * visualizzazione: è il verso del prodotto. Il titolare non "entra" in Roma per
 * vedere i turni di Roma — guarda il suo mercoledì, e ogni turno dice a quale
 * sede appartiene. Chi ha una sede sola non vede alcuna differenza: i badge e i
 * filtri compaiono da due sedi in su.
 *
 * Stesso impianto dell'agenda del professionista, e per le stesse ragioni:
 * scegliere un giorno **fa ripartire la lista da lì** invece di farla scorrere
 * fino a lì, perché `SectionList.scrollToLocation` fallisce in silenzio (vedi
 * il commento esteso in `(waiter)/(tabs)/turni.tsx`).
 *
 * La differenza è cosa si cerca: il professionista vuole sapere quando lavora,
 * la sede vuole sapere **cosa è scoperto**. Per questo il pallino sul
 * calendario diventa arancio sui giorni con un buco, sotto c'è il conto della
 * settimana, e un filtro riduce l'agenda ai soli turni da coprire: il quadro
 * d'insieme senza costruire una vista di pianificazione.
 *
 * Fino al 13/09/2026 quel filtro era una schermata a parte («Copertura turni»),
 * cioè una seconda lista degli stessi turni con gli stessi tap: si è rivelata
 * la stessa agenda detta peggio, e i suoi due contenuti — i ruoli e i buchi —
 * sono rientrati qui, nella card e in questo filtro.
 */
export default function ManagerShiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const venueQuery = useOwnerVenues();
  const { venues, isMultiVenue } = venueQuery;
  // Un collaboratore può essere entrato per *guardare* l'agenda: senza il
  // permesso sui turni la RLS rifiuterebbe l'insert, e il form si chiuderebbe
  // con un errore che non spiega niente.
  const canCreateShift = venueQuery.canAny("can_manage_shifts");
  const upcomingQuery = useOwnerShifts();
  const pull = usePullToRefresh(() => upcomingQuery.refetch());
  // La propria scheda nell'organico, se chi gestisce lavora anche lui.
  const self = useSelfStaff();

  const today = todayString();
  /** Da dove parte l'agenda: lo sposta solo una scelta sul calendario. */
  const [anchorDay, setAnchorDay] = useState(today);
  /** Il giorno evidenziato: lo sposta anche lo scorrimento della lista. */
  const [visibleDay, setVisibleDay] = useState(today);
  const [expanded, setExpanded] = useState(false);
  /** L'agenda ridotta a ciò che manca da coprire. */
  const [onlyShort, setOnlyShort] = useState(false);
  /** «I miei turni»: esiste solo per chi gestisce ed è anche in organico. */
  const [onlyMine, setOnlyMine] = useState(false);
  /**
   * Cosa si sta guardando: i turni per giorno, o l'organico per persona.
   *
   * Due viste sotto lo stesso calendario e gli stessi chip di sede, non due
   * schermate: sono gli stessi turni girati di lato — «cosa succede mercoledì»
   * contro «chi lavora quanto» — e la settimana scelta vale per entrambe.
   */
  const [mode, setMode] = useState<"days" | "people">("days");
  /**
   * Le sedi nascoste dai chip. Si tiene l'insieme **escluso** e non quello
   * incluso di proposito: così una sede appena aperta compare da sé, mentre con
   * un insieme di inclusi resterebbe invisibile finché qualcuno non la spunta.
   *
   * ⚠️ Non persiste e non tocca le query — i turni sono già tutti in cache. È un
   * filtro di vista, non una sede attiva sotto mentite spoglie.
   */
  const [hiddenVenues, setHiddenVenues] = useState<Set<string>>(new Set());

  const listRef = useRef<SectionList<ShiftWithCount, ShiftSection>>(null);
  const syncing = useRef(false);

  /** Le sedi accese: è lo scope con cui la vista per persona interroga. */
  const scope = useMemo(
    () => venues.filter((v) => !hiddenVenues.has(v.id)).map((v) => v.id),
    [venues, hiddenVenues]
  );

  /** Il badge di una sede, o niente se il titolare ne ha una sola. */
  const venueBadge = useCallback(
    (venueId: string) => {
      if (!isMultiVenue) return undefined;
      const i = venues.findIndex((v) => v.id === venueId);
      if (i < 0) return undefined;
      return { name: venues[i].name, accent: venueAccent(i) };
    },
    [venues, isMultiVenue]
  );

  const visible = useCallback(
    (s: { venue_id: string }) => !hiddenVenues.has(s.venue_id),
    [hiddenVenues]
  );

  const upcoming = useMemo(
    () => (upcomingQuery.data ?? []).filter(visible),
    [upcomingQuery.data, visible]
  );

  // I giorni con turni e, fra questi, quelli con un buco: i due insiemi che
  // colorano i pallini del calendario.
  const { marked, alerts } = useMemo(() => {
    const m = new Set<string>();
    const a = new Set<string>();
    for (const s of upcoming) {
      m.add(s.date);
      if (isShort(s)) a.add(s.date);
    }
    return { marked: m, alerts: a };
  }, [upcoming]);

  /** Quanti turni restano da coprire in tutto: decide se il filtro esiste. */
  const shortCount = useMemo(() => upcoming.filter(isShort).length, [upcoming]);
  // Coprire l'ultimo buco spegne il filtro da sé: restare su una lista vuota
  // con il comando per uscirne appena sparito sarebbe un vicolo cieco.
  const filtering = onlyShort && shortCount > 0;

  /**
   * I turni su cui c'è **chi guarda**, per chi gestisce e lavora.
   *
   * Le proprie schede sono una per sede (`staff_people` → N `staff_members`) e
   * un turno è di una sede sola: si confrontano gli id delle appartenenze, che
   * `OwnerPerson` porta già nell'embed dell'organico. Le appartenenze finite
   * restano fuori — `getOwnerPeople` le filtra.
   */
  const myMemberIds = useMemo(
    () => new Set((self.person?.memberships ?? []).map((m) => m.id)),
    [self.person]
  );
  const isMine = useCallback(
    (s: ShiftWithCount) =>
      s.shift_assignments.some(
        (a) => a.staff_member_id && myMemberIds.has(a.staff_member_id)
      ),
    [myMemberIds]
  );
  const mineCount = useMemo(
    () => (myMemberIds.size === 0 ? 0 : upcoming.filter(isMine).length),
    [upcoming, isMine, myMemberIds]
  );
  // Stessa regola del filtro dei buchi: un filtro che non filtra niente non
  // compare, e se l'ultimo turno proprio sparisce si spegne da sé.
  const filteringMine = onlyMine && mineCount > 0;

  const dayGroups = useMemo(
    () => groupByDay(upcoming, (s) => s.date),
    [upcoming]
  );

  const sections = useMemo<ShiftSection[]>(() => {
    const future = dayGroups.filter((g) => (g.date ?? "") >= anchorDay);
    if (filtering || filteringMine) {
      // Un giorno rimasto senza turni scoperti non è un giorno vuoto da
      // mostrare: è un giorno a posto, e sparisce insieme ai suoi turni.
      // I due filtri si sommano (scoperti **e** miei), che è l'unica lettura
      // sensata di due comandi accesi insieme.
      return future
        .map((g) => ({
          ...g,
          data: g.data.filter(
            (s) => (!filtering || isShort(s)) && (!filteringMine || isMine(s))
          ),
        }))
        .filter((g) => g.data.length > 0);
    }
    // Fino al 14/09/2026 lo storico chiudeva l'agenda come sezione in coda.
    // Adesso è una schermata sua (`(manager)/storico`), perché i suoi filtri
    // devono passare dal server: qui i chip di sede filtrano le righe già
    // scaricate — va bene per i prossimi turni, che sono tutti in cache, ma su
    // una lista paginata accorcia le pagine e tronca la lista.
    return future;
  }, [dayGroups, anchorDay, filtering, filteringMine, isMine]);

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
      <Mono gold>{isMultiVenue ? "Le tue sedi" : "La tua sede"}</Mono>
      <Display className="mt-1 text-3xl">I tuoi turni</Display>
    </View>
  );

  // Senza nessuna sede non c'è niente da organizzare.
  if (venueQuery.isLoading || venueQuery.isError || venues.length === 0) {
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
          <NoVenuesState subtitle="Ti serve una sede prima di organizzare i turni." />
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
            {canCreateShift ? (
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
            ) : null}
          </View>
        </View>

        {/* L'interruttore fra le due viste. Sta sopra il calendario perché
            decide *cosa* si legge sotto, mentre il calendario e i chip di sede
            valgono per entrambe. */}
        <View className="mt-4 flex-row items-center gap-2">
          {(["days", "people"] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                className={cn(
                  "rounded-full border px-3.5 py-1.5",
                  on ? "border-border-gold bg-bg-2" : "border-border"
                )}
              >
                <Mono gold={on}>{m === "days" ? "Giorni" : "Persone"}</Mono>
              </Pressable>
            );
          })}
          {/* L'agenda guarda avanti; i turni già fatti si cercano, non si
              scorrono. Da qui perché è dove si cercano — non in fondo alla
              lista, dove stavano prima. */}
          <Pressable
            onPress={() => router.push("/(manager)/storico")}
            accessibilityRole="button"
            className="ml-auto flex-row items-center gap-1"
            hitSlop={8}
          >
            <Mono>Storico</Mono>
            <Icon name="chevR" size={14} color="#8C8579" />
          </Pressable>
        </View>

        <WeekCalendar
          className="mt-3"
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

        {/* Un chip per sede, tutti accesi all'apertura. Riduce la vista, non il
            perimetro: i turni sono già in cache e spegnere una sede non fa
            partire nessuna query. Sta sotto il calendario perché è un filtro
            dell'agenda, non una scelta che precede il resto. */}
        {isMultiVenue ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-3 -mx-5"
            contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
          >
            {venues.map((v, i) => {
              const on = !hiddenVenues.has(v.id);
              return (
                <Pressable
                  key={v.id}
                  onPress={() =>
                    setHiddenVenues((prev) => {
                      const next = new Set(prev);
                      // Spegnere l'ultima sede accesa lascerebbe un'agenda vuota
                      // senza dire perché: l'ultima resta accesa.
                      if (!on) next.delete(v.id);
                      else if (venues.length - next.size > 1) next.add(v.id);
                      return next;
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${v.name}: ${on ? "mostrata" : "nascosta"}`}
                  style={on ? { borderColor: venueAccent(i) } : undefined}
                  className={cn(
                    "flex-row items-center gap-2 rounded-full border px-3 py-1.5",
                    on ? "bg-bg-2" : "border-border bg-transparent"
                  )}
                >
                  <View
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: on ? venueAccent(i) : "transparent",
                      borderWidth: on ? 0 : 1,
                      borderColor: "#8C8579",
                    }}
                  />
                  <Text
                    className={cn(
                      "text-[13px]",
                      on ? "font-sans-semibold text-t1" : "text-t3"
                    )}
                  >
                    {v.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {mode === "people" ? (
        <PeopleWeekList
          from={startOfWeek(visibleDay)}
          to={addDaysToDate(startOfWeek(visibleDay), 6)}
          scope={scope}
          onOpenShift={openShift}
          paddingBottom={insets.bottom + 96}
        />
      ) : upcomingQuery.isLoading ? (
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
          ListHeaderComponent={
            <View className="mb-4 flex-row flex-wrap items-center gap-2">
            {/* Compare solo quando c'è davvero qualcosa da coprire: su un'agenda
                in ordine sarebbe un comando che non filtra niente. */}
            {shortCount > 0 ? (
              <Pressable
                onPress={() => setOnlyShort((v) => !v)}
                // Sfondo inline come nelle `Pill`: `bg-warning/15` passerebbe da
                // `color-mix`, che react-native-css non regge.
                style={
                  filtering
                    ? { backgroundColor: "rgba(226,146,47,0.15)" }
                    : undefined
                }
                className={cn(
                  "flex-row items-center gap-2 self-start rounded-full border px-3.5 py-2",
                  filtering ? "border-warning" : "border-border-2 bg-bg-2"
                )}
                accessibilityRole="button"
                accessibilityState={{ selected: filtering }}
                accessibilityLabel={
                  filtering
                    ? "Mostra tutti i turni"
                    : `Mostra solo i turni scoperti, ${shortCount}`
                }
              >
                <Icon name="alert" size={13} color="#E2922F" strokeWidth={2.4} />
                <Text className="text-[13px] font-sans-semibold text-warning">
                  {filtering
                    ? "Mostra tutti i turni"
                    : `Solo i turni scoperti (${shortCount})`}
                </Text>
              </Pressable>
            ) : null}

            {/* Chi organizza i turni spesso ci lavora: qui trova i suoi senza
                cercarsi in mezzo all'agenda della sede. Compare solo se ne ha. */}
            {mineCount > 0 ? (
              <Pressable
                onPress={() => setOnlyMine((v) => !v)}
                style={
                  filteringMine
                    ? { backgroundColor: "rgba(234,181,76,0.15)" }
                    : undefined
                }
                className={cn(
                  "flex-row items-center gap-2 self-start rounded-full border px-3.5 py-2",
                  filteringMine ? "border-gold" : "border-border-2 bg-bg-2"
                )}
                accessibilityRole="button"
                accessibilityState={{ selected: filteringMine }}
                accessibilityLabel={
                  filteringMine
                    ? "Mostra i turni di tutti"
                    : `Mostra solo i tuoi turni, ${mineCount}`
                }
              >
                <Icon name="user" size={13} color="#EAB54C" strokeWidth={2.4} />
                <Text className="text-[13px] font-sans-semibold text-gold">
                  {filteringMine
                    ? "Turni di tutti"
                    : `I miei turni (${mineCount})`}
                </Text>
              </Pressable>
            ) : null}
            </View>
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
                venue={venueBadge(item.venue_id)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View className="flex-1 justify-center">
              {filtering ? (
                <EmptyState
                  title="Nessun turno scoperto da qui in poi"
                  subtitle={
                    away
                      ? "I turni da coprire sono prima di questo giorno: tocca «Oggi» per vederli."
                      : "Tocca «Mostra tutti i turni» per tornare all'agenda completa."
                  }
                />
              ) : filteringMine ? (
                <EmptyState
                  title="Nessun tuo turno da qui in poi"
                  subtitle={
                    away
                      ? "I tuoi turni sono prima di questo giorno: tocca «Oggi» per vederli."
                      : "Tocca «Turni di tutti» per tornare all'agenda completa."
                  }
                />
              ) : (
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
              )}
            </View>
          }
        />
      )}
    </View>
  );
}
