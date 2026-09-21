import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Display } from "@/components/ui/Display";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { StatCard } from "@/components/ui/StatCard";
import { AbsencesToHandle } from "@/features/absences/AbsencesToHandle";
import { useOwnerTodayAssignments } from "@/features/assignments/hooks";
import { useMyRosterIds } from "@/features/assignments/useMyRoster";
import { useUnreadCount } from "@/features/notifications/hooks";
import { ProUpsellCard } from "@/features/plan/ProLock";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import {
  computeHomeStats,
  periodLabel,
  periodRange,
  STATS_PERIODS,
  type StatsPeriod,
} from "@/features/shifts/homeStats";
import { useOwnerShifts, useOwnerShiftsRange } from "@/features/shifts/hooks";
import { ManagerShiftCard } from "@/features/shifts/ManagerShiftCard";
import { useSelfStaff } from "@/features/staff/self";
import { NoVenuesState } from "@/features/venues/NoVenuesState";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { useAuth } from "@/lib/auth";
import {
  formatHours,
  formatRelativeStart,
  formatShiftRange,
  todayString,
} from "@/lib/format";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  /** Dove lavora oggi. Assente con una sede sola. */
  venue?: { name: string; accent: string };
  /** È chi guarda: da quando chi gestisce può stare in organico. */
  isMe?: boolean;
  onPress?: () => void;
};

export default function ManagerHome() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = session!.user.id;
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "Ristoratore";

  const venueQuery = useOwnerVenues();
  const { venues, isMultiVenue, canAny } = venueQuery;
  const [period, setPeriod] = useState<StatsPeriod>("week");
  // Lo stesso intervallo che apre il Planning, quindi la stessa entry di cache.
  const { from, to } = useMemo(() => periodRange(period), [period]);
  const periodQuery = useOwnerShiftsRange(from, to);
  // Memo sull'identità del dato in cache: React Query la tiene stabile finché il
  // dato non cambia davvero.
  const stats = useMemo(
    () => computeHomeStats(periodQuery.data ?? []),
    [periodQuery.data],
  );
  // Cambiare periodo cambia la chiave di cache: senza questo i quattro numeri
  // cadrebbero a zero per un istante prima di riempirsi, e uno zero è una
  // risposta — non un'attesa.
  const statsReady = periodQuery.isSuccess;

  // `getOwnerShifts` è la lista dei prossimi turni **senza** limite superiore, e
  // resta tale: l'anteprima deve mostrare cosa viene dopo anche di domenica
  // sera, quando il periodo scelto è ormai finito.
  const shiftsQuery = useOwnerShifts();
  const shifts = shiftsQuery.data ?? [];
  const assignQuery = useOwnerTodayAssignments();
  const todayAssignments = assignQuery.data ?? [];
  const unread = useUnreadCount(userId).data ?? 0;

  /**
   * Il proprio prossimo turno, per chi gestisce e lavora.
   *
   * `shifts` è già ordinato per data e ora e comincia da oggi, quindi il primo
   * che mi riguarda è il prossimo. Le proprie schede sono una per sede e un
   * turno è di una sede sola: si confrontano gli id delle righe di organico
   * (`venue_member_id`), che il contesto porta già.
   */
  const self = useSelfStaff();
  const mine = useMyRosterIds();
  const myNextShift = useMemo(() => {
    if (mine.size === 0) return undefined;
    // `shiftsQuery.data` e non `shifts`: quel `?? []` crea un array nuovo a ogni
    // render, e come dipendenza rifarebbe il memo sempre.
    return (shiftsQuery.data ?? []).find(
      (s) =>
        s.status !== "cancelled" &&
        s.shift_assignments.some(
          (a) =>
            a.venue_member_id &&
            mine.has(a.venue_member_id) &&
            a.status !== "declined",
        ),
    );
  }, [shiftsQuery.data, mine]);

  /** Il badge di una sede, o niente se il titolare ne ha una sola. */
  const venueBadge = (venueId: string | undefined) => {
    if (!isMultiVenue || !venueId) return undefined;
    const i = venues.findIndex((v) => v.id === venueId);
    if (i < 0) return undefined;
    return { name: venues[i].name, accent: venueAccent(i) };
  };

  // L'anteprima mostra i prossimi turni così come sono, annullati compresi: un
  // turno annullato che era in programma domani è un'informazione, non rumore.
  // I numeri sopra invece li escludono, e li calcola `computeHomeStats`.
  const upcoming = shifts;

  // "Chi lavora oggi": lo staff assegnato ai turni di oggi. Include chi è in
  // sala adesso su un turno cominciato ieri sera, quindi si ordina per giorno
  // **e** ora: il solo orario metterebbe un turno iniziato alle 22:00 di ieri
  // dopo il pranzo di oggi.
  const workers: TodayWorker[] = todayAssignments
    .map((a) => {
      const sm = a.staff_member;
      const isMe = self.isSelf(sm?.waiter_id);
      // Si apre la scheda di organico, anche la propria: da quando il CV non
      // c'è più non esiste una «scheda pubblica» da professionista che per un
      // gestore sarebbe vuota, e `staff/[id]` sa già dire «questo sei tu».
      const personId = sm?.person_id ?? null;
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
        venue: venueBadge(a.shift?.venue_id),
        isMe,
        onPress: personId
          ? () => router.push(`/(manager)/staff/${personId}`)
          : undefined,
      };
    })
    .sort((a, b) =>
      `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
    );

  const { refreshing, onRefresh } = usePullToRefresh(() =>
    Promise.all([
      venueQuery.refetch(),
      shiftsQuery.refetch(),
      // Anche i numeri del periodo: sono la prima cosa che si guarda dopo aver
      // tirato giù, e senza questo resterebbero quelli di prima.
      periodQuery.refetch(),
      assignQuery.refetch(),
    ]),
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
          {/* Non più uno switcher: non c'è più una sede da scegliere. Con un
              sede sola è il suo nome, come è sempre stato; con più sedi è il
              conteggio, e porta dove si gestiscono — il Profilo. */}
          {venues.length === 0 ? null : isMultiVenue ? (
            <Pressable
              onPress={() => router.push("/(manager)/(tabs)/profilo")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`${venues.length} sedi. Tocca per gestirle.`}
              className="mt-1 flex-row items-center gap-1"
            >
              <Text className="text-sm text-t3">{venues.length} sedi</Text>
              <Icon name="chevR" size={14} color="#8C8579" />
            </Pressable>
          ) : (
            <Text className="mt-1 text-sm text-t3">{venues[0].name}</Text>
          )}
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
      ) : shiftsQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : (
        <>
          {/* A colpo d'occhio. Il periodo sta **sopra i numeri che qualifica**:
              senza, "31 turni" non dice su quanto tempo. */}
          <View className="gap-2.5">
            <View className="flex-row items-center justify-between gap-3">
              <Mono className="flex-1">{periodLabel(period)}</Mono>
              <View className="flex-row gap-1.5">
                {STATS_PERIODS.map((p) => (
                  <Chip
                    key={p.value}
                    label={p.label}
                    gold
                    active={period === p.value}
                    onPress={() => setPeriod(p.value)}
                  />
                ))}
              </View>
            </View>
            <View className="flex-row gap-2.5">
              <StatCard
                loading={!statsReady}
                value={String(stats.total)}
                label="Turni"
                hint={`${stats.done} svolti · ${stats.upcoming} da fare`}
              />
              <StatCard
                loading={!statsReady}
                value={String(stats.shortCount)}
                label="Turni scoperti"
                hint="solo quelli da fare"
                tone={stats.shortCount > 0 ? "warning" : "normal"}
                onPress={() => router.push("/(manager)/(tabs)/turni")}
              />
            </View>
            <View className="flex-row gap-2.5">
              <StatCard
                loading={!statsReady}
                value={String(stats.missingSlots)}
                label="Posti da coprire"
                hint="persone che mancano"
                tone={stats.missingSlots > 0 ? "warning" : "normal"}
                onPress={() => router.push("/(manager)/(tabs)/turni")}
              />
              <StatCard
                loading={!statsReady}
                value={formatHours(stats.hours)}
                label="Ore pianificate"
              />
            </View>
          </View>

          {/* Ferie e permessi da decidere, malattie appena comunicate. */}
          <AbsencesToHandle
            enabled={canAny("can_manage_staff")}
            onOpenPerson={(personId) =>
              router.push(`/(manager)/staff/${personId}`)
            }
          />

          {/* Chi non ha ancora una sede vede i KPI a zero e questo invito, non
              un muro al posto della home: la prima schermata dell'app deve
              somigliare a quella che userà tutti i giorni. */}
          {venues.length === 0 ? (
            <NoVenuesState subtitle="Aggiungi le informazioni della tua sede per iniziare a organizzare i turni." />
          ) : null}

          {/* Upsell Pro — visibile solo agli utenti Free */}
          <ProUpsellCard />

          {/* Il proprio turno prima di quelli degli altri: chi organizza i
              turni e ci lavora apre l'app anche per sapere quando attacca. */}
          {myNextShift ? (
            <Card
              className="rounded-3xl border-border-gold p-5"
              onPress={() => router.push(`/(manager)/shift/${myNextShift.id}`)}
            >
              <Mono gold>
                {formatRelativeStart(myNextShift.date, myNextShift.start_time)}
              </Mono>
              <Text
                className="mt-2 text-2xl font-sans-bold text-t1"
                style={{ fontVariant: ["tabular-nums"], letterSpacing: -0.5 }}
              >
                {formatShiftRange(myNextShift.start_time, myNextShift.end_time)}
              </Text>
              <Text className="mt-1 text-[13px] text-t2" numberOfLines={1}>
                {[
                  "Il tuo turno",
                  myNextShift.title,
                  venueBadge(myNextShift.venue_id)?.name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Card>
          ) : null}

          {/* Chi lavora oggi */}
          {workers.length > 0 ? (
            <View className="gap-3">
              <View>
                <Mono gold>Oggi in sede · {workers.length}</Mono>
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
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-base font-sans-bold text-t1">
                            {w.name}
                          </Text>
                          {w.isMe ? <Pill label="Tu" variant="tag" /> : null}
                        </View>
                        {/* Con più sedi il ruolo da solo non basta: «Barman»
                            non dice in quale sala si presenta stasera. */}
                        {w.role || w.venue ? (
                          <Text className="text-xs text-t3">
                            {[w.role, w.venue?.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
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
                    venue={venueBadge(shift.venue_id)}
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
