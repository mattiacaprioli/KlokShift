import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { Mono } from "@/components/ui/Mono";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { REVIEWS_ENABLED } from "@/features/reviews/config";
import { StatCard } from "@/components/ui/StatCard";
import { formatHours } from "@/lib/format";
import { usePersonPerformance } from "@/features/assignments/hooks";
import { useWaiterPublicCard } from "@/features/reviews/hooks";

/**
 * Performance di una persona: turni svolti, ore totali, affidabilità, rating.
 *
 * Su **tutte** le sedi del titolare. Prima l'aggregazione era per appartenenza, e
 * un'assenza fatta a Milano non scalfiva il 100% di affidabilità di Roma: due
 * mezze verità al posto di un numero (20260913110100).
 *
 * L'affidabilità resta derivata qui e non in SQL: è il rapporto di due numeri che
 * la RPC già restituisce, e portarla nel database aggiungerebbe una colonna, una
 * decisione sull'arrotondamento e un secondo posto dove gestire `past_total = 0`.
 */
export function PersonPerformanceSection({
  personId,
  waiterId,
}: {
  personId: string;
  waiterId: string | null;
}) {
  const query = usePersonPerformance(personId);
  const perf = query.data ?? null;
  const card = useWaiterPublicCard(waiterId ?? undefined).data ?? null;

  const totalPast = perf?.past_total ?? 0;
  const workedCount = perf?.worked_count ?? 0;
  const noShow = perf?.no_show_count ?? 0;
  const declined = perf?.declined_count ?? 0;
  const reliability = totalPast > 0 ? workedCount / totalPast : null;
  const totalHours = perf?.total_hours ?? 0;

  return (
    <View className="gap-3">
      <Mono>Performance</Mono>

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-2 self-start" />
      ) : (
        <>
          {REVIEWS_ENABLED && waiterId ? (
            <View className="flex-row items-center justify-between rounded-2xl border border-border-2 bg-bg-card px-4 py-3">
              <Text className="text-sm text-t2">Valutazione clienti</Text>
              <RatingBadge
                avg={card?.rating_avg ?? null}
                count={card?.rating_count ?? null}
              />
            </View>
          ) : null}

          <View className="flex-row gap-3">
            <StatCard value={String(workedCount)} label="turni svolti" />
            <StatCard value={formatHours(totalHours)} label="ore totali" />
          </View>

          {reliability != null ? (
            <View className="gap-2 rounded-2xl border border-border bg-bg-card px-4 py-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-t2">Affidabilità</Text>
                <Text className="text-sm font-sans-semibold text-gold">
                  {Math.round(reliability * 100)}%
                </Text>
              </View>
              <ProgressBar progress={reliability} />
              {noShow + declined > 0 ? (
                <Text className="text-xs text-t3">
                  {noShow} assenze · {declined} rifiuti su {totalPast} turni
                </Text>
              ) : (
                <Text className="text-xs text-t3">
                  Sempre presente su {totalPast}{" "}
                  {totalPast === 1 ? "turno" : "turni"}
                </Text>
              )}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
