import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, View } from "@/tw";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { QueryError } from "@/components/ui/QueryError";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import { withShift } from "@/features/assignments/agenda";
import {
  useMyAssignedUpcoming,
  useRespondToAssignment,
} from "@/features/assignments/hooks";
import { useMyWorkHistoryTotals } from "@/features/assignments/history";
import { MyShiftCard } from "@/features/assignments/MyShiftCard";
import { NextShiftCard } from "@/features/assignments/NextShiftCard";
import { useUnreadCount } from "@/features/notifications/hooks";
import { useMyPendingInvites } from "@/features/staff/hooks";
import { useAuth } from "@/lib/auth";
import { formatHours } from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useToast } from "@/providers/Toast";

/** Quanti turni seguono il primo, prima di mandare all'agenda. */
const PREVIEW_COUNT = 3;

export default function WaiterHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile } = useAuth();
  const waiterId = session!.user.id;

  const assignedQuery = useMyAssignedUpcoming(waiterId);
  const pendingInvites = useMyPendingInvites(waiterId).data ?? [];
  const totals = useMyWorkHistoryTotals(waiterId);
  const unread = useUnreadCount(waiterId).data ?? 0;
  const respond = useRespondToAssignment();
  const pull = usePullToRefresh(() =>
    Promise.all([assignedQuery.refetch(), totals.refetch()])
  );

  const [declining, setDeclining] = useState<string | null>(null);

  const items = useMemo(
    () => withShift(assignedQuery.data ?? []),
    [assignedQuery.data]
  );
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "Cameriere";

  // Quanti turni deve ancora confermare: è la sola cosa in questa schermata su
  // cui c'è qualcosa da fare, quindi ha un avviso suo.
  const daConfermare = items.filter((a) => a.status === "assigned").length;

  const next = items[0];
  // Il primo sta già nella card grande: la lista sotto riprende da lì.
  const following = items.slice(1, 1 + PREVIEW_COUNT);

  function onConfirm(id: string) {
    respond.mutate(
      { id, status: "confirmed" },
      {
        onSuccess: () => toast.show("Presenza confermata"),
        onError: () => toast.show("Operazione non riuscita. Riprova.", "error"),
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
        onError: () => {
          setDeclining(null);
          toast.show("Operazione non riuscita. Riprova.", "error");
        },
      }
    );
  }

  const openAgenda = () => router.push("/(waiter)/(tabs)/turni");

  return (
    <>
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
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
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Mono gold>La tua area</Mono>
            <Display className="mt-1 text-4xl">Ciao, {firstName}</Display>
          </View>
          <NotificationBell
            count={unread}
            onPress={() => router.push("/(waiter)/notifiche")}
          />
        </View>

        {pendingInvites.length > 0 ? (
          <AlertBanner
            icon="users"
            title={
              pendingInvites.length === 1
                ? "1 richiesta di collaborazione"
                : `${pendingInvites.length} richieste di collaborazione`
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

        <View>
          <SectionHeader
            title="Il tuo prossimo turno"
            actionLabel={items.length > 0 ? "Agenda" : undefined}
            onAction={openAgenda}
          />
          {assignedQuery.isLoading ? (
            <ActivityIndicator color="#EAB54C" className="mt-4" />
          ) : assignedQuery.isError ? (
            <QueryError onRetry={() => assignedQuery.refetch()} />
          ) : next == null ? (
            <EmptyState
              title="Nessun turno in programma"
              subtitle="Quando una sede ti assegna un turno lo trovi qui."
            />
          ) : (
            <View className="gap-3">
              <NextShiftCard
                item={next}
                onPress={() => router.push(`/(waiter)/shift/${next.shift.id}`)}
                onConfirm={() => onConfirm(next.id)}
                onDecline={() => setDeclining(next.id)}
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

        {/* Il lavoro, non la vetrina: i numeri che il professionista guarda ogni
            giorno sono i suoi turni e le sue ore. Rating e recensioni restano nel
            profilo, dove si va quando si ha qualcosa da mostrare. */}
        <View className="flex-row gap-2.5">
          <StatCard
            value={String(totals.count)}
            label="turni svolti"
            onPress={() => router.push("/(waiter)/storico")}
          />
          <StatCard
            value={formatHours(totals.totalHours)}
            label="ore totali"
            onPress={() => router.push("/(waiter)/storico")}
          />
        </View>
      </ScrollView>

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
