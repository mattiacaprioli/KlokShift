import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { Mono } from "@/components/ui/Mono";
import { StatCard } from "@/components/ui/StatCard";
import { formatDate, formatHours, formatShiftRange } from "@/lib/format";
import {
  usePersonPerformance,
  usePersonWorkedShifts,
} from "@/features/assignments/hooks";

/**
 * Ore & presenze di una persona dell'organico (turni interni già svolti).
 *
 * I numeri sono dell'**azienda**, non della sede: sono le ore della sua busta
 * paga. Chi fa 20 ore a Roma e 20 a Milano per lo stesso titolare ne ha 40, e la
 * 41ª è straordinario anche se nessuna delle due sedi da sola ci arriva.
 *
 * `showVenue` mostra la sede su ogni turno recente: serve solo a chi ha più di
 * una sede — altrimenti sarebbe la stessa parola ripetuta sotto ogni riga.
 */
export function PersonHoursSection({
  personId,
  showVenue = false,
}: {
  personId: string;
  showVenue?: boolean;
}) {
  // Totali dal database; la lista sono solo le ultime righe, già limitate.
  const perfQuery = usePersonPerformance(personId);
  const recentQuery = usePersonWorkedShifts(personId);
  const query = { isLoading: perfQuery.isLoading || recentQuery.isLoading };

  const monthHours = perfQuery.data?.month_hours ?? 0;
  const monthShifts = perfQuery.data?.month_shifts ?? 0;
  const recent = recentQuery.data ?? [];

  return (
    <View className="gap-3">
      <Mono>Ore &amp; presenze</Mono>

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-2 self-start" />
      ) : (
        <>
          <View className="flex-row gap-3">
            <StatCard value={formatHours(monthHours)} label="ore questo mese" />
            <StatCard value={String(monthShifts)} label="turni questo mese" />
          </View>

          {recent.length > 0 ? (
            <View className="gap-2">
              {recent.map((a) => (
                <Card key={a.id} className="rounded-2xl border-border-2 px-4 py-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-sm font-sans-semibold text-t1">
                        {formatDate(a.date)}
                      </Text>
                      <Text className="text-xs text-t3">
                        {formatShiftRange(a.start_time, a.end_time)}
                        {showVenue ? ` · ${a.venue_name}` : ""}
                      </Text>
                    </View>
                    <Text className="text-sm font-sans-semibold text-gold">
                      {formatHours(a.hours)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-t3">Nessun turno svolto ancora.</Text>
          )}
        </>
      )}
    </View>
  );
}
