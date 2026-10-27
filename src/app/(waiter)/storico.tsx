import { ListSkeleton } from "@/components/ui/Skeleton";
import { ActivityIndicator, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  formatDate,
  formatHours,
  formatHoursVariance,
  formatShiftRange,
} from "@/lib/format";
import { formatClockTime } from "@/features/clock/hours";
import {
  useMyWorkHistory,
  useMyWorkHistoryRange,
  type WorkHistoryItem,
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
  const router = useRouter();
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

  // Il totale sono le ore che contano per la sede, come nel riepilogo Ore.
  // Quelle che aspettano orari o approvazione stanno a parte, e ogni card dice
  // cosa manca: un numero solo farebbe passare per lavorate ore che il
  // consulente non riceverà.
  const stats = (
    <View className="gap-2.5">
      <View className="flex-row gap-2.5">
        <StatCard value={String(history.count)} label="Turni svolti" />
        <StatCard
          value={formatHours(history.totalHours)}
          label="Ore lavorate"
          hint={
            history.pendingHours > 0
              ? `+ ${formatHours(history.pendingHours)} in attesa della sede`
              : undefined
          }
        />
      </View>
      {history.pendingHours > 0 ? (
        <Text className="text-xs leading-4 text-t3">
          Le ore in attesa contano quando la sede inserisce o approva gli
          orari. Sotto, turno per turno, cosa manca.
        </Text>
      ) : null}
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
        <ListSkeleton className="px-5 pt-2" label="Caricamento dei turni svolti…" />
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
          renderItem={({ item }) => (
            <HistoryCard
              item={item}
              onPress={() => router.push(`/(waiter)/shift/${item.shiftId}`)}
            />
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

/**
 * Un turno svolto: dove, cosa, quando e **da dove vengono le ore**. Senza
 * quest'ultima riga un 9 h su un turno 14:00–22:00 era un numero senza motivo.
 */
function HistoryCard({
  item: i,
  onPress,
}: {
  item: WorkHistoryItem;
  onPress: () => void;
}) {
  const detail = [i.title, i.roleName].filter(Boolean).join(" · ");
  const pending = i.counts === false;
  // Lo scarto si dice solo su ore definitive: una proposta da approvare o
  // l'orario del turno non sono uno scostamento.
  const variance =
    !pending && i.workedHours != null
      ? formatHoursVariance(i.workedHours - i.plannedHours)
      : null;
  const clock = clockLine(i);
  const line = sourceLine(i, clock);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="rounded-3xl border-border-2 p-4">
        <View className="flex-row items-center gap-3">
          <Avatar uri={i.logoUrl ?? undefined} name={i.venueName} size={44} />
          <View className="flex-1">
            <Text className="text-base font-sans-bold text-t1" numberOfLines={1}>
              {i.venueName}
            </Text>
            {detail ? (
              <Text className="text-xs text-t2" numberOfLines={1}>
                {detail}
              </Text>
            ) : null}
            <Text className="text-xs text-t3">
              {formatDate(i.date)} · {formatShiftRange(i.start_time, i.end_time)}
            </Text>
          </View>
          <View className="items-end">
            <Text
              className={cn(
                "text-sm font-sans-bold",
                pending ? "text-t3" : "text-gold"
              )}
            >
              {formatHours(i.hours)}
            </Text>
            {pending ? (
              <Text className="text-[11px] text-t3">in attesa</Text>
            ) : variance ? (
              <Text className="text-[11px] text-t3">{variance} sul turno</Text>
            ) : null}
          </View>
        </View>

        {line ? (
          <View className="mt-3 flex-row items-center justify-between gap-3 border-t border-border pt-3">
            <View className="flex-1 flex-row items-center gap-2">
              <Icon name="clock" size={14} color="#8c857a" />
              <Text className="flex-1 text-xs text-t3" numberOfLines={3}>
                {line.text}
              </Text>
            </View>
            {line.pill ? (
              <Pill label={line.pill.label} variant={line.pill.variant} />
            ) : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

/**
 * Gli orari della timbratura, e di chi sono: «Timbrato» solo se li ha timbrati
 * il dipendente e nessuno li ha toccati. Inseriti o corretti dalla sede si
 * dice, con il motivo se c'è: altrimenti si leggerebbero come propri orari che
 * ha scritto qualcun altro. Il dettaglio del turno mostra anche quelli timbrati.
 */
function clockLine(i: WorkHistoryItem): string | null {
  if (!i.clockInAt) return null;
  if (!i.clockOutAt) {
    return `Entrata ${formatClockTime(i.clockInAt)}, uscita non timbrata`;
  }
  const range = `${formatClockTime(i.clockInAt)}–${formatClockTime(i.clockOutAt)}`;
  const why = i.clockEditReason ? ` · «${i.clockEditReason}»` : "";
  switch (i.clockEdit) {
    case "entered":
      return `Orari inseriti dalla sede: ${range}${why}`;
    case "corrected":
      return `Timbratura corretta dalla sede: ${range}${why}`;
    default:
      return `Timbrato ${range}`;
  }
}

type SourceLine = {
  text: string;
  pill: { label: string; variant: "accepted" | "tag" | "pending" } | null;
};

/**
 * Da dove vengono le ore di un turno e, se non contano ancora, cosa manca. I
 * motivi sono quelli di «Ore da sistemare» sul lato sede: la stessa riga, vista
 * da chi l'ha lavorata.
 */
function sourceLine(i: WorkHistoryItem, clock: string | null): SourceLine | null {
  const proposed =
    i.proposedHours != null ? ` (${formatHours(i.proposedHours)})` : "";

  if (i.counts === false) {
    switch (i.pendingReason) {
      case "not_clocked":
        return {
          text: "Non hai timbrato: le ore contano quando la sede inserisce gli orari",
          pill: { label: "Non timbrato", variant: "pending" },
        };
      case "missing_out":
        return {
          text: `${clock ?? "Uscita non timbrata"}: le ore contano quando la sede inserisce l'uscita`,
          pill: { label: "Uscita mancante", variant: "pending" },
        };
      default:
        return {
          text: `${clock ?? "Timbratura"}${proposed} · le ore contano quando la sede le approva`,
          pill: { label: "Da approvare", variant: "pending" },
        };
    }
  }

  switch (i.source) {
    case "approved":
      return {
        text: clock ?? "Timbratura approvata",
        pill: { label: "Approvate", variant: "accepted" },
      };
    case "adjusted":
      return {
        text: clock
          ? `${clock} · ore inserite da chi gestisce`
          : "Ore inserite da chi gestisce",
        pill: { label: "Rettificate", variant: "tag" },
      };
    case "pending":
      // Solo da un database non ancora migrato, che non dice se la riga conta.
      return {
        text: `${clock ?? "Timbratura"}${proposed} · da approvare dalla sede`,
        pill: { label: "Da approvare", variant: "pending" },
      };
    case "planned":
      // Due turni sovrapposti: il tratto comune conta una volta sola.
      return {
        text:
          i.hours < i.plannedHours
            ? "Orario del turno · le ore in comune con un altro turno contano una volta"
            : "Orario del turno, senza timbratura",
        pill: null,
      };
    default:
      return null;
  }
}
