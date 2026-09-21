import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, View } from "@/tw";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { Segmented } from "@/components/ui/Segmented";
import { WeekCalendar } from "@/components/ui/WeekCalendar";
import { absenceForShift } from "@/features/absences/conflicts";
import { useMyAbsences } from "@/features/absences/hooks";
import { MY_ABSENCE_NOTE } from "@/features/absences/labels";
import {
  type AgendaItem,
  type AgendaSection,
  daysWithShifts,
  groupAssignmentsByDay,
  groupByDay,
  withShift,
} from "@/features/assignments/agenda";
import {
  useMyAssignedUpcoming,
  useRespondToAssignment,
} from "@/features/assignments/hooks";
import { MyShiftCard } from "@/features/assignments/MyShiftCard";
import { useStaffPlanning } from "@/features/planning/hooks";
import { VenuePlanningList } from "@/features/planning/VenuePlanningList";
import type { ShiftWithVenue } from "@/features/shifts/types";
import { useMyEmployers } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import {
  addDaysToDate,
  formatDayLabel,
  todayString,
} from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useToast } from "@/providers/Toast";

/** Quanto ignorare il ritorno dello scorrimento dopo aver scelto un giorno. */
const SYNC_SETTLE_MS = 400;

const VIEWABILITY = { itemVisiblePercentThreshold: 20 };

/**
 * Quanti giorni di planning della sede si caricano in un colpo.
 *
 * Sei settimane: copre il mese che si sfoglia più quello dopo, e sta dentro il
 * tetto di 62 giorni che `get_staff_planning` applica comunque lato server.
 */
const PLANNING_WINDOW_DAYS = 42;

const MODES = [
  { id: "mine", label: "I miei" },
  { id: "venue", label: "La sede" },
] as const;

type Mode = (typeof MODES)[number]["id"];

/**
 * L'agenda del professionista: i turni che le sedi gli hanno assegnato,
 * raggruppati per giorno sotto un calendario.
 *
 * **Scegliere un giorno fa ripartire l'agenda da lì**, non la fa scorrere fino
 * a lì. Lo scorrimento era la prima versione e non funzionava:
 * `SectionList.scrollToLocation` calcola un offset nullo quando le celle non
 * sono ancora state disposte, e fallisce *in silenzio* — nessun
 * `onScrollToIndexFailed`, nessun movimento. Misurare le sezioni a mano non è
 * un'alternativa: ogni cella sta in un contenitore suo, quindi `onLayout`
 * restituisce 0 per tutte. Ripartire dal giorno scelto non dipende da nessuna
 * misura, e per giunta risponde meglio alla domanda che si fa toccando una
 * data: «cosa faccio quel giorno».
 *
 * Il calendario resta comunque agganciato allo scorrimento: scorrendo, il
 * giorno evidenziato segue la lista.
 *
 * La conferma di presenza è inline perché è l'azione più frequente di tutta
 * l'app da questo lato — farla passare per il dettaglio turno significava due
 * tocchi in più per la cosa che si fa ogni settimana. Il rifiuto invece resta
 * dietro una conferma: avvisa la sede e non si torna indietro da soli.
 *
 * ── «I miei» / «La sede» ─────────────────────────────────────────────────
 *
 * Un turno è un lavoro di squadra, e la seconda vista risponde alle due domande
 * che l'agenda personale non sa fare: chi c'è stasera con me, e chi è in turno
 * sabato a cui chiedere un cambio.
 *
 * Il selettore cambia la lista, **non** il calendario: mese, giorno scelto e
 * ancora restano gli stessi passando da una vista all'altra, perché sono la
 * domanda («cosa succede giovedì») e non la risposta. Per la stessa ragione le
 * due liste non tengono uno stato per uno: lo leggono da qui.
 *
 * Il selettore compare solo per chi è in organico da qualche parte
 * (`useMyEmployers`): a chi non lo è, la seconda vista non avrebbe niente da
 * mostrare e un selettore con metà dei tocchi inerti è peggio di nessun
 * selettore.
 */
export default function WaiterShiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session } = useAuth();
  const waiterId = session!.user.id;

  const assignedQuery = useMyAssignedUpcoming(waiterId);
  const respond = useRespondToAssignment();

  const today = todayString();
  const [mode, setMode] = useState<Mode>("mine");
  const [declining, setDeclining] = useState<string | null>(null);
  /** Da dove parte l'agenda: lo sposta solo una scelta sul calendario. */
  const [anchorDay, setAnchorDay] = useState(today);
  /** Il giorno evidenziato: lo sposta anche lo scorrimento della lista. */
  const [visibleDay, setVisibleDay] = useState(today);
  const [expanded, setExpanded] = useState(false);

  const listRef = useRef<SectionList<AgendaItem, AgendaSection>>(null);
  // Alza la mano subito dopo una scelta: la lista si sta ancora ricomponendo e
  // il ritorno dello scorrimento riscriverebbe il giorno appena scelto.
  const syncing = useRef(false);

  const items = useMemo(
    () => withShift(assignedQuery.data ?? []),
    [assignedQuery.data]
  );
  const allSections = useMemo(() => groupAssignmentsByDay(items), [items]);
  const sections = useMemo(
    () => allSections.filter((s) => (s.date ?? "") >= anchorDay),
    [allSections, anchorDay]
  );
  const daConfermare = items.filter((a) => a.status === "assigned");

  // Il planning della sede: una finestra che parte dal giorno da cui parte
  // l'agenda, così scegliere una data lontana va a prendersi il periodo giusto
  // invece di mostrare un vuoto. Il server filtra già da `anchorDay` in avanti,
  // quindi qui non serve il `filter` che la vista «I miei» fa sulle sezioni.
  const planningTo = addDaysToDate(anchorDay, PLANNING_WINDOW_DAYS);
  const planning = useStaffPlanning(anchorDay, planningTo, mode === "venue");
  const planningSections = useMemo(
    () => groupByDay(planning.data ?? [], (s) => s.date),
    [planning.data]
  );

  // Chi è in organico da qualche parte: decide se il selettore ha senso, e se
  // sulle card serve il nome della sede.
  const employers = useMyEmployers(waiterId);

  // Le proprie assenze approvate: un turno che ci cade dentro dice «Sei in
  // ferie». Solo quelle dello **stesso** titolare del turno — le ferie chieste a
  // un'altra azienda non riguardano questa sede.
  const myAbsences = useMyAbsences(waiterId);
  const approvedAbsences = useMemo(
    () => (myAbsences.data ?? []).filter((a) => a.status === "approved"),
    [myAbsences.data]
  );
  // Le assenze stanno sulla **persona** (`member_id`) e la persona è una per
  // azienda: la mia in quell'azienda si ricava dalle appartenenze del contesto.
  const { memberships } = useOwnerVenues();
  function absenceNoteFor(shift: ShiftWithVenue): string | null {
    const workspaceId = shift.venue?.workspace_id;
    const memberId = memberships.find(
      (m) => m.workspace_id === workspaceId
    )?.member_id;
    const hit = absenceForShift(
      shift,
      approvedAbsences.filter((a) => !!memberId && a.member_id === memberId)
    );
    return hit ? MY_ABSENCE_NOTE[hit.kind] : null;
  }
  const venueCount = employers.data?.length ?? 0;

  // I pallini del calendario seguono la vista: sono la mappa di **questa**
  // lista, e lasciarli sui propri turni mentre si guarda la sede indicherebbe
  // giorni che la lista sotto non ha.
  const myDays = useMemo(() => daysWithShifts(items), [items]);
  const planningDays = useMemo(
    () => new Set((planning.data ?? []).map((s) => s.date)),
    [planning.data]
  );
  const marked = mode === "venue" ? planningDays : myDays;

  const pull = usePullToRefresh(() =>
    Promise.all(
      mode === "venue"
        ? [planning.refetch()]
        : [assignedQuery.refetch()]
    )
  );

  function goToDay(date: string, browsing?: boolean) {
    syncing.current = true;
    setVisibleDay(date);
    setAnchorDay(date);
    // Scegliere un giorno richiude il mese: con la griglia aperta l'agenda ha
    // due righe di spazio e il cambio non si vedrebbe. Sfogliare i mesi invece
    // la lascia aperta — si sta ancora guardando.
    if (expanded && !browsing) setExpanded(false);
    // La lista riparte dal giorno scelto, quindi va riportata in cima:
    // altrimenti si resterebbe all'altezza di scorrimento di prima.
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
      const first = viewableItems.find((v) => v.section != null);
      const date = (first?.section as AgendaSection | undefined)?.date;
      if (date) setVisibleDay((prev) => (prev === date ? prev : date));
    },
    []
  );

  function onConfirm(id: string) {
    respond.mutate(
      { id, status: "confirmed" },
      {
        onSuccess: () => toast.show("Presenza confermata"),
        onError: (e) =>
          toast.show(userErrorMessage(e, "Operazione non riuscita. Riprova."), "error"),
      }
    );
  }

  function doDecline() {
    if (!declining) return;
    respond.mutate(
      { id: declining, status: "declined" },
      {
        onSuccess: () => {
          setDeclining(null);
          toast.show("Turno rifiutato");
        },
        onError: (e) => {
          setDeclining(null);
          toast.show(userErrorMessage(e, "Operazione non riuscita. Riprova."), "error");
        },
      }
    );
  }

  const away = anchorDay !== today;

  return (
    <>
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 12 }}>
        <View className="px-5">
          <View className="flex-row items-end justify-between gap-3">
            <View className="flex-1">
              <Mono gold>
                {mode === "venue"
                  ? `${planningSections.length} ${planningSections.length === 1 ? "giornata" : "giornate"}`
                  : daConfermare.length > 0
                    ? `${daConfermare.length} da confermare`
                    : `${items.length} in programma`}
              </Mono>
              <Display className="mt-1 text-3xl">
                {mode === "venue" ? "Turni della sede" : "I miei turni"}
              </Display>
            </View>
            {/* Il ritorno: una volta spostata l'ancora, "oggi" non è più a
                portata di scorrimento e va rimesso a portata di tocco. */}
            {away ? (
              <Pressable
                onPress={() => goToDay(today)}
                className="rounded-full border border-border-gold bg-bg-2 px-3 py-1.5"
                accessibilityRole="button"
              >
                <Mono gold>Oggi</Mono>
              </Pressable>
            ) : null}
          </View>
          {venueCount > 0 ? (
            <Segmented
              className="mt-4"
              options={MODES}
              value={mode}
              onChange={setMode}
            />
          ) : null}
          <WeekCalendar
            className="mt-4"
            selected={visibleDay}
            onSelect={goToDay}
            marked={marked}
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
          />
        </View>

        {mode === "venue" ? (
          <VenuePlanningList
            sections={planningSections}
            isLoading={planning.isLoading}
            isError={planning.isError}
            onRetry={() => planning.refetch()}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY}
            showVenue={venueCount > 1}
            today={today}
            away={away}
            anchorDay={anchorDay}
            paddingBottom={insets.bottom + 96}
          />
        ) : assignedQuery.isLoading ? (
          <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />
        ) : assignedQuery.isError ? (
          <QueryError onRetry={() => assignedQuery.refetch()} />
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
              daConfermare.length > 0 ? (
                <AlertBanner
                  className="mb-4"
                  icon="alert"
                  title={
                    daConfermare.length === 1
                      ? "1 turno da confermare"
                      : `${daConfermare.length} turni da confermare`
                  }
                  subtitle="La sede sta aspettando la tua risposta"
                  onPress={() => goToDay(daConfermare[0].shift.date)}
                />
              ) : null
            }
            renderSectionHeader={({ section }) => (
              <View className="bg-bg-0 pb-2 pt-3">
                <Mono gold={section.date === today}>{section.title}</Mono>
              </View>
            )}
            renderItem={({ item }) => (
              <View className="pb-3">
                <MyShiftCard
                  shift={item.shift}
                  status={item.status}
                  role={item.role?.name}
                  onPress={() => router.push(`/(waiter)/shift/${item.shift.id}`)}
                  onConfirm={() => onConfirm(item.id)}
                  onDecline={() => setDeclining(item.id)}
                  pending={
                    respond.isPending && respond.variables?.id === item.id
                  }
                  absenceNote={absenceNoteFor(item.shift)}
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
                      ? `Dal ${formatDayLabel(anchorDay).toLowerCase()} non hai turni assegnati. Tocca «Oggi» per tornare ai prossimi.`
                      : "Quando una sede ti assegna un turno lo trovi qui. Lo storico delle ore è nel Profilo."
                  }
                />
              </View>
            }
          />
        )}
      </View>

      <ConfirmModal
        visible={declining != null}
        title="Rifiutare il turno?"
        message="La sede verrà avvisata."
        confirmLabel="Rifiuta"
        destructive
        pending={respond.isPending}
        onConfirm={doDecline}
        onCancel={() => setDeclining(null)}
      />
    </>
  );
}
