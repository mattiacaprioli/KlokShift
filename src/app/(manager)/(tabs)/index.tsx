import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { StatCard } from "@/components/ui/StatCard";
import { ManagerShiftCard } from "@/features/shifts/ManagerShiftCard";
import { ProUpsellCard } from "@/features/plan/ProLock";
import { useAuth } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { formatShiftRange, todayString } from "@/lib/format";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { VenueSwitcher } from "@/features/venues/VenueSwitcher";
import { useMyShifts, useVenuePastShiftsCount } from "@/features/shifts/hooks";
import { useTodayAssignments } from "@/features/assignments/hooks";
import { shiftCounts } from "@/features/assignments/coverage";
import { useUnreadCount } from "@/features/notifications/hooks";

const PREVIEW_COUNT = 3;

type TodayWorker = {
  key: string;
  name: string;
  avatarUri?: string;
  role: string | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  /** Giorno del turno: serve a ordinare, e a segnalare chi è qui da ieri sera. */
  date: string;
  start: string;
  end: string;
  onPress?: () => void;
};

export default function ManagerHome() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = session!.user.id;
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "Ristoratore";

  const venueQuery = useActiveVenue();
  const venue = venueQuery.venue;
  const shiftsQuery = useMyShifts(venue?.id);
  const shifts = shiftsQuery.data ?? [];
  const pastCount = useVenuePastShiftsCount(venue?.id).data ?? 0;
  const assignQuery = useTodayAssignments(venue?.id);
  const todayAssignments = assignQuery.data ?? [];
  const unread = useUnreadCount(userId).data ?? 0;

  // `getMyShifts` torna già solo i turni non conclusi (turni notturni inclusi):
  // qui non serve più rifiltrare per data, che tagliava fuori proprio quelli.
  const upcoming = shifts;
  // Gli annullati non hanno posti da coprire: esclusi dai KPI.
  const activeUpcoming = upcoming.filter((s) => s.status !== "cancelled");
  const counts = activeUpcoming.map((s) => shiftCounts(s));
  const filled = counts.reduce((n, c) => n + c.filled, 0);
  const totalPos = counts.reduce((n, c) => n + c.total, 0);
  // L'unico numero su cui c'è da agire: turni che partono senza abbastanza
  // gente. Esce da `counts`, già calcolato: nessuna query in più.
  const shortCount = counts.filter((c) => c.short).length;

  // "Chi lavora oggi": lo staff assegnato ai turni di oggi. Include chi è in
  // sala adesso su un turno cominciato ieri sera, quindi si ordina per giorno
  // **e** ora: il solo orario metterebbe un turno iniziato alle 22:00 di ieri
  // dopo il pranzo di oggi.
  const workers: TodayWorker[] = todayAssignments
    .map((a) => {
      const sm = a.staff_member;
      const waiterId = sm?.waiter_id ?? null;
      return {
        key: `asg-${a.id}`,
        name: sm?.display_name ?? "Staff",
        avatarUri: sm?.waiter?.avatar_url ?? undefined,
        role: a.role?.name ?? null,
        ratingAvg: sm?.waiter?.waiter_profile?.rating_avg ?? null,
        ratingCount: sm?.waiter?.waiter_profile?.rating_count ?? null,
        date: a.shift?.date ?? "",
        start: a.shift?.start_time ?? "",
        end: a.shift?.end_time ?? "",
        onPress: waiterId
          ? () => router.push(`/(manager)/cameriere/${waiterId}`)
          : undefined,
      };
    })
    .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));

  const { refreshing, onRefresh } = usePullToRefresh(() =>
    Promise.all([
      venueQuery.refetch(),
      shiftsQuery.refetch(),
      assignQuery.refetch(),
    ])
  );

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 96,
        gap: 24,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      }
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Mono gold>La tua area</Mono>
          <Display className="mt-1 text-4xl">Ciao, {firstName}</Display>
          {/* Il nome della sede era un testo morto: ora è il punto da cui si
              cambia sede, perché è lì che si guarda "dove sono" prima di fare
              qualsiasi cosa. Con una sede sola resta identico a prima. */}
          <VenueSwitcher />
        </View>
        <NotificationBell
          count={unread}
          onPress={() => router.push("/(manager)/notifiche")}
        />
      </View>

      {venueQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-16" />
      ) : venueQuery.isError ? (
        <QueryError className="mt-10" onRetry={() => venueQuery.refetch()} />
      ) : !venue ? (
        <View className="mt-6">
          <EmptyState
            title="Configura il tuo locale"
            subtitle="Aggiungi le informazioni del tuo locale per iniziare a organizzare i turni."
          />
          <GoldButton
            className="mt-2"
            label="Configura locale"
            onPress={() => router.push("/(manager)/venue/new")}
          />
        </View>
      ) : shiftsQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : (
        <>
          {/* A colpo d'occhio */}
          <View className="gap-2.5">
            <Mono>A colpo d&apos;occhio</Mono>
            <View className="flex-row gap-2.5">
              <StatCard
                value={String(activeUpcoming.length)}
                label="turni in programma"
              />
              <StatCard
                value={String(shortCount)}
                label="turni scoperti"
                onPress={() => router.push("/(manager)/(tabs)/turni")}
              />
            </View>
            <View className="flex-row gap-2.5">
              <StatCard
                value={totalPos > 0 ? `${filled}/${totalPos}` : "—"}
                label="posti coperti"
              />
              <StatCard value={String(pastCount)} label="turni svolti" />
            </View>
          </View>

          {/* Upsell Pro — visibile solo agli utenti Free */}
          <ProUpsellCard />

          {/* Chi lavora oggi */}
          {workers.length > 0 ? (
            <View className="gap-3">
              <View>
                <Mono gold>Oggi in sala · {workers.length}</Mono>
                <Display className="mt-0.5 text-2xl">Chi lavora oggi</Display>
              </View>
              <View className="gap-3">
                {workers.map((w) => (
                  <Card
                    key={w.key}
                    className="rounded-3xl border-border-2 p-4"
                    onPress={w.onPress}
                  >
                    <View className="flex-row items-center gap-3">
                      <Avatar uri={w.avatarUri} name={w.name} size={44} />
                      <View className="flex-1">
                        <Text className="text-base font-sans-bold text-t1">
                          {w.name}
                        </Text>
                        {w.role ? (
                          <Text className="text-xs text-t3">{w.role}</Text>
                        ) : null}
                        {REVIEWS_ENABLED ? (
                          <RatingBadge
                            avg={w.ratingAvg}
                            count={w.ratingCount}
                            className="mt-1"
                          />
                        ) : null}
                      </View>
                      {w.start && w.end ? (
                        <View className="items-end gap-1">
                          <View className="flex-row items-center gap-1.5">
                            <Icon name="clock" size={14} color="#8c857a" />
                            <Text className="text-sm text-t2">
                              {formatShiftRange(w.start, w.end)}
                            </Text>
                          </View>
                          {/* Turno di ieri sera ancora in corso: senza questo
                              sembrerebbe uno che attacca oggi a quell'ora. */}
                          {w.date && w.date !== todayString() ? (
                            <Pill label="Da ieri" variant="pending" />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          {/* Prossimi turni */}
          <View className="gap-3">
            <View className="flex-row items-end justify-between gap-3">
              <View className="flex-1">
                <Mono>I tuoi turni</Mono>
                <Display className="mt-0.5 text-2xl">Prossimi turni</Display>
              </View>
              {shifts.length > 0 ? (
                <Pressable
                  onPress={() => router.push("/(manager)/(tabs)/turni")}
                  hitSlop={8}
                >
                  <Text className="text-sm font-sans-semibold text-gold">
                    Vedi tutti
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {shiftsQuery.isError ? (
              <QueryError
                onRetry={() => shiftsQuery.refetch()}
                subtitle="Non siamo riusciti a caricare i turni. Riprova."
              />
            ) : upcoming.length === 0 ? (
              <EmptyState
                title="Nessun turno in programma"
                subtitle="Crea un turno dalla scheda «Turni»."
              />
            ) : (
              <View className="gap-3">
                {upcoming.slice(0, PREVIEW_COUNT).map((shift) => (
                  <ManagerShiftCard
                    key={shift.id}
                    variant="compact"
                    shift={shift}
                    onPress={() => router.push(`/(manager)/shift/${shift.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}
