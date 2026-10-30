import { NextShiftSkeleton } from "@/components/ui/Skeleton";
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, View } from "@/tw";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { QueryError } from "@/components/ui/QueryError";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { withShift } from "@/features/assignments/agenda";
import {
  useMyAssignedUpcoming,
  useRespondToAssignment,
} from "@/features/assignments/hooks";
import { DeclineShiftModal } from "@/features/assignments/DeclineShiftModal";
import { usePendingRequestsForShift } from "@/features/changeRequests/hooks";
import { myPendingRequestText } from "@/features/changeRequests/labels";
import { MyShiftCard } from "@/features/assignments/MyShiftCard";
import { NextShiftCard } from "@/features/assignments/NextShiftCard";
import { HomeClockCard } from "@/features/clock/HomeClockCard";
import {
  blocksPlannedClockIn,
  canStartUnplannedClock,
  homeClockState,
} from "@/features/clock/availability";
import { useMyUnplannedClock } from "@/features/clock/hooks";
import { UnplannedClockCard } from "@/features/clock/UnplannedClockCard";
import { useUnreadCount } from "@/features/notifications/hooks";
import { useMyPendingInvites } from "@/features/staff/hooks";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useToast } from "@/providers/Toast";
import { isShiftOver } from "@/lib/format";
import { JoinWorkspaceCard } from "@/features/onboarding/JoinWorkspaceCard";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { HelpButton } from "@/components/ui/HelpButton";

/** Quanti turni seguono il primo, prima di mandare all'agenda. */
const PREVIEW_COUNT = 3;

export default function WaiterHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile } = useAuth();
  const waiterId = session!.user.id;

  const assignedQuery = useMyAssignedUpcoming(waiterId);
  const unplannedQuery = useMyUnplannedClock();
  const pendingInvites = useMyPendingInvites(waiterId).data ?? [];
  const context = useOwnerVenues();
  // Nessun team e nessun invito da accettare: al posto del «nessun turno»
  // la Home dice come farsi aggiungere. Solo a contesto caricato, senza errori.
  const notInAnyWorkspace =
    !context.isPending &&
    !context.isError &&
    !context.memberships.some((m) => m.status === "active") &&
    context.pendingInvites.length === 0;
  const unread = useUnreadCount(waiterId).data ?? 0;
  const respond = useRespondToAssignment();
  const pull = usePullToRefresh(() =>
    Promise.all([
      assignedQuery.refetch(),
      unplannedQuery.refetch(),
      context.refetch(),
    ])
  );

  const [declining, setDeclining] = useState<string | null>(null);

  const items = useMemo(
    () => withShift(assignedQuery.data ?? []),
    [assignedQuery.data]
  );
  const clockItems = items.filter((item) => homeClockState(item) != null);
  // Con un turno pianificato in corso o in arrivo non si propone il fuori
  // turno in quella sede: si timbra quello (la stessa regola della RPC). E
  // finché i turni assegnati non sono arrivati non lo si propone affatto.
  // Un'entrata fuori turno già aperta resta sempre, per l'uscita.
  const unplanned = unplannedQuery.data ?? [];
  const assignedReady = assignedQuery.isSuccess ? items : undefined;
  const canStartUnplanned = (venueMemberId: string) =>
    canStartUnplannedClock(assignedReady, venueMemberId);
  const showUnplanned = unplanned.some(
    (entry) => entry.open != null || canStartUnplanned(entry.venueMemberId)
  );
  // E viceversa: con un fuori turno aperto l'entrata pianificata aspetta
  // l'uscita da quello (la stessa regola della RPC, `clock_already_open`).
  const plannedInBlocked = blocksPlannedClockIn(unplanned);
  // Un'entrata ancora aperta resta nella query anche oltre la fine pianificata,
  // perché la Home deve offrire l'uscita. Non è però il «prossimo turno».
  // Un turno annullato tiene le sue assegnazioni e resta leggibile: l'agenda lo
  // mostra barrato, ma qui non è né il prossimo turno né uno da confermare.
  const upcomingItems = items.filter(
    (item) => !isShiftOver(item.shift) && item.shift.status !== "cancelled"
  );
  // Senza nome un saluto neutro, mai un mestiere al posto della persona.
  const firstName = (profile?.full_name ?? "").split(" ")[0];

  // Quanti turni deve ancora confermare: è la sola cosa in questa schermata su
  // cui c'è qualcosa da fare, quindi ha un avviso suo.
  const daConfermare = upcomingItems.filter(
    (a) => a.status === "assigned"
  ).length;

  // Il turno che si sta timbrando sta già nella sezione Timbratura (e la sua
  // card apre il dettaglio): qui riparte dal successivo, non lo ripete.
  const clockIds = new Set(clockItems.map((item) => item.id));
  const laterItems = upcomingItems.filter((item) => !clockIds.has(item.id));
  const next = laterItems[0];
  // Il primo sta già nella card grande: la lista sotto riprende da lì.
  const following = laterItems.slice(1, 1 + PREVIEW_COUNT);
  // Solo per il turno confermato della card grande: una lettura, non una per
  // turno. La RLS restituisce soltanto la propria richiesta.
  const nextPendingRequest =
    usePendingRequestsForShift(next?.shift.id ?? "", next?.status === "confirmed")
      .data?.[0] ?? null;

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

  const openAgenda = () => router.push("/(waiter)/(tabs)/turni");

  return (
    <View className="flex-1 bg-bg-0">
      <View
        className="shrink-0 flex-row items-start justify-between gap-3 px-5 pb-5"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-1">
          <Mono gold>La tua area</Mono>
          <Display className="mt-1 text-4xl leading-[46px]">
            {firstName ? `Ciao, ${firstName}` : "Ciao"}
          </Display>
        </View>
        <View className="flex-row gap-2">
          <HelpButton onPress={() => router.push("/(waiter)/aiuto")} />
          <NotificationBell
            count={unread}
            onPress={() => router.push("/(waiter)/notifiche")}
          />
        </View>
      </View>

      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 96,
          gap: 20,
        }}
        refreshControl={
          <RefreshControl
            tintColor="#EAB54C"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
          />
        }
      >
        {pendingInvites.length > 0 ? (
          <AlertBanner
            icon="users"
            title={
              pendingInvites.length === 1
                ? "1 invito da un'azienda"
                : `${pendingInvites.length} inviti dalle aziende`
            }
            subtitle="Tocca per rispondere"
            onPress={() => router.push("/(waiter)/inviti")}
          />
        ) : null}

        {daConfermare > 0 ? (
          <AlertBanner
            icon="alert"
            title={
              daConfermare === 1
                ? "1 turno da confermare"
                : `${daConfermare} turni da confermare`
            }
            subtitle="La sede sta aspettando la tua risposta"
            onPress={openAgenda}
          />
        ) : null}

        {clockItems.length > 0 || showUnplanned || unplannedQuery.isError ? (
          <View>
            <SectionHeader title="Timbratura" />
            <View className="gap-3">
              {clockItems.map((item) => (
                <HomeClockCard
                  key={item.id}
                  item={item}
                  inBlocked={plannedInBlocked}
                  onPress={() => router.push(`/(waiter)/shift/${item.shift.id}`)}
                />
              ))}
              {/* Accanto a un turno da timbrare il fuori turno è l'eccezione:
                  una riga, non una seconda card. Aperto resta una card. */}
              {unplanned.map((entry) => (
                <UnplannedClockCard
                  key={entry.venueMemberId}
                  entry={entry}
                  canStart={canStartUnplanned(entry.venueMemberId)}
                  compact={clockItems.length > 0}
                />
              ))}
              {/* Senza questa lettura non si sa se c'è un'entrata aperta da
                  chiudere: meglio dirlo che non mostrare niente. */}
              {unplannedQuery.isError ? (
                <QueryError
                  title="Timbratura senza turno non disponibile"
                  subtitle="Non sappiamo se hai un'entrata aperta. Controlla la connessione e riprova."
                  onRetry={() => unplannedQuery.refetch()}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader
            title="Il tuo prossimo turno"
            actionLabel={upcomingItems.length > 0 ? "Agenda" : undefined}
            onAction={openAgenda}
          />
          {assignedQuery.isLoading ? (
            <NextShiftSkeleton />
          ) : assignedQuery.isError ? (
            <QueryError onRetry={() => assignedQuery.refetch()} />
          ) : next == null && notInAnyWorkspace ? (
            <JoinWorkspaceCard />
          ) : next == null ? (
            <EmptyState
              title={
                clockItems.length > 0
                  ? "Nessun altro turno in programma"
                  : "Nessun turno in programma"
              }
              subtitle="Quando una sede ti assegna un turno lo trovi qui."
            />
          ) : (
            <View className="gap-3">
              <NextShiftCard
                item={next}
                onPress={() => router.push(`/(waiter)/shift/${next.shift.id}`)}
                onConfirm={() => onConfirm(next.id)}
                onDecline={() => setDeclining(next.id)}
                pendingRequestText={
                  nextPendingRequest ? myPendingRequestText(nextPendingRequest) : null
                }
                pending={
                  respond.isPending && respond.variables?.id === next.id
                }
              />
              {following.map((a) => (
                <MyShiftCard
                  key={a.id}
                  variant="compact"
                  shift={a.shift}
                  status={a.status}
                  role={a.role?.name}
                  onPress={() => router.push(`/(waiter)/shift/${a.shift.id}`)}
                />
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      <DeclineShiftModal
        assignmentId={declining}
        onClose={() => setDeclining(null)}
      />
    </View>
  );
}
