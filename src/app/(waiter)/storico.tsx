import { ActivityIndicator, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/lib/auth";
import { formatDate, formatHours, formatShiftRange } from "@/lib/format";
import {
  useMyWorkHistory,
  useMyWorkHistoryRange,
} from "@/features/assignments/history";
import {
  periodLabel,
  periodRange,
  shiftPeriod,
  STATS_PERIODS,
  type StatsPeriod,
} from "@/features/shifts/homeStats";

type Filter = StatsPeriod | "all";

const FILTERS: { value: Filter; label: string }[] = [
  ...STATS_PERIODS,
  { value: "all", label: "Tutto" },
];

export default function WaiterHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const waiterId = session!.user.id;
  // Il mese è il periodo che finisce in busta paga; «Tutto» è lo storico di
  // sempre, a pagine. Le frecce scorrono all'indietro, mai oltre il presente.
  const [filter, setFilter] = useState<Filter>("month");
  const [offset, setOffset] = useState(0);
  const period: StatsPeriod = filter === "all" ? "month" : filter;
  const anchor = useMemo(() => shiftPeriod(period, offset), [period, offset]);
  const { from, to } = useMemo(() => periodRange(period, anchor), [period, anchor]);

  const all = useMyWorkHistory(waiterId, filter === "all");
  const range = useMyWorkHistoryRange(waiterId, from, to, filter !== "all");
  const history = filter === "all" ? all : range;

  const selectFilter = (f: Filter) => {
    setFilter(f);
    setOffset(0);
  };

  const stats = (
    <View className="flex-row gap-2.5">
      <StatCard value={String(history.count)} label="Turni svolti" />
      <StatCard value={formatHours(history.totalHours)} label="Ore lavorate" />
    </View>
  );

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Il tuo lavoro" title="Le mie ore" />
      </View>

      <View className="gap-3 px-5 pb-2">
        <View className="flex-row gap-1.5">
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              gold
              active={filter === f.value}
              onPress={() => selectFilter(f.value)}
            />
          ))}
        </View>
        <View className="flex-row items-center justify-between gap-3">
          {filter === "all" ? (
            <Mono className="flex-1">Da sempre · tutte le aziende</Mono>
          ) : (
            <>
              <Pressable
                hitSlop={12}
                accessibilityLabel="Periodo precedente"
                onPress={() => setOffset((o) => o - 1)}
              >
                <Icon name="chevL" size={20} color="#F8F4ED" />
              </Pressable>
              <Mono className="flex-1 text-center">
                {periodLabel(period, anchor, offset)}
              </Mono>
              <Pressable
                hitSlop={12}
                accessibilityLabel="Periodo successivo"
                disabled={offset === 0}
                onPress={() => setOffset((o) => Math.min(o + 1, 0))}
                className={offset === 0 ? "opacity-30" : undefined}
              >
                <Icon name="chevR" size={20} color="#F8F4ED" />
              </Pressable>
            </>
          )}
        </View>
      </View>

      {history.isLoading ? (
        <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />
      ) : history.isError ? (
        <View className="px-5">
          <QueryError onRetry={history.refetch} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 48,
            gap: 12,
          }}
          data={history.items}
          keyExtractor={(i) => i.key}
          ListHeaderComponent={history.items.length > 0 ? stats : null}
          renderItem={({ item: i }) => (
            <Card className="rounded-3xl border-border-2 p-4">
              <View className="flex-row items-center gap-3">
                <Avatar uri={i.logoUrl ?? undefined} name={i.venueName} size={44} />
                <View className="flex-1">
                  <Text
                    className="text-base font-sans-bold text-t1"
                    numberOfLines={1}
                  >
                    {i.venueName}
                  </Text>
                  <Text className="text-xs text-t3">
                    {formatDate(i.date)} ·{" "}
                    {formatShiftRange(i.start_time, i.end_time)}
                  </Text>
                </View>
                <Text className="text-sm font-sans-bold text-gold">
                  {formatHours(i.hours)}
                </Text>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <View style={{ gap: 16 }}>
              {stats}
              <EmptyState
                title={
                  filter === "all"
                    ? "Ancora nessun turno svolto"
                    : "Nessun turno svolto in questo periodo"
                }
                subtitle={
                  filter === "all"
                    ? "Qui vedrai lo storico dei tuoi turni e le ore totali."
                    : "Cambia periodo con le frecce, o guarda tutto lo storico."
                }
              />
            </View>
          }
          // Lo storico arriva a pagine: si carica la successiva avvicinandosi
          // al fondo, invece di scaricare tutto all'apertura.
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (filter === "all" && all.hasNextPage && !all.isFetchingNextPage) {
              all.fetchNextPage();
            }
          }}
          ListFooterComponent={
            filter === "all" && all.isFetchingNextPage ? (
              <ActivityIndicator color="#EAB54C" style={{ marginTop: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
