import { useMemo } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { Pill } from "@/components/ui/Pill";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { formatDate, formatShiftRange } from "@/lib/format";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useVenueCoverage } from "@/features/assignments/hooks";
import { shiftCoverage } from "@/features/assignments/coverage";
import type { CoverageShift } from "@/features/assignments/api";

export default function CoverageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const venue = useActiveVenue().venue;

  const query = useVenueCoverage(venue?.id);
  const shifts = useMemo(() => query.data ?? [], [query.data]);

  // Raggruppa per giorno (già ordinati per data/orario dalla query).
  const groups = useMemo(() => {
    const m = new Map<string, CoverageShift[]>();
    for (const s of shifts) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return [...m.entries()];
  }, [shifts]);

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 48,
        gap: 20,
      }}
    >
      <ScreenHeader eyebrow="Organico" title="Copertura turni" />

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : shifts.length === 0 ? (
        <EmptyState
          title="Nessun turno interno in programma"
          subtitle="I turni con il tuo staff compariranno qui con la loro copertura."
        />
      ) : (
        groups.map(([date, dayShifts]) => (
          <View key={date} className="gap-3">
            <Mono>{formatDate(date)}</Mono>
            {dayShifts.map((s) => {
              const cov = shiftCoverage(s);
              return (
                <Card
                  key={s.id}
                  className="rounded-3xl border-border-2 p-4"
                  onPress={() => router.push(`/(manager)/shift/${s.id}`)}
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-base font-sans-bold text-t1">
                        {s.title}
                      </Text>
                      <Text className="text-xs text-t3">
                        {formatShiftRange(s.start_time, s.end_time)}
                      </Text>
                    </View>
                    {cov.missing > 0 ? (
                      <Pill label={`manca ${cov.missing}`} variant="pending" icon="alert" />
                    ) : cov.required > 0 ? (
                      <Pill label="Coperto" variant="accepted" />
                    ) : null}
                  </View>

                  {s.shift_role_requirements.length > 0 ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {cov.rows.map((r) => (
                        <Pill
                          key={r.role}
                          label={`${r.role} ${r.covered}/${r.required}`}
                          variant={r.covered >= r.required ? "accepted" : "pending"}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text className="mt-2 text-xs text-t3">
                      Nessun fabbisogno impostato · {s.positions_filled} assegnati
                    </Text>
                  )}
                </Card>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}
