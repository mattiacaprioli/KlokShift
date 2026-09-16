import { ActivityIndicator, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useAuth } from "@/lib/auth";
import { formatDate, formatHours, formatShiftRange } from "@/lib/format";
import { useMyWorkHistory } from "@/features/assignments/history";

export default function WaiterHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const waiterId = session!.user.id;
  const history = useMyWorkHistory(waiterId);

  const stats = (
    <View className="flex-row gap-2.5">
      <StatCard value={String(history.count)} label="Turni svolti" />
      <StatCard value={formatHours(history.totalHours)} label="Ore totali" />
    </View>
  );

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Il tuo lavoro" title="Le mie ore" />
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
                title="Ancora nessun turno svolto"
                subtitle="Qui vedrai lo storico dei tuoi turni e le ore totali."
              />
            </View>
          }
          // Lo storico arriva a pagine: si carica la successiva avvicinandosi
          // al fondo, invece di scaricare tutto all'apertura.
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (history.hasNextPage && !history.isFetchingNextPage) {
              history.fetchNextPage();
            }
          }}
          ListFooterComponent={
            history.isFetchingNextPage ? (
              <ActivityIndicator color="#EAB54C" style={{ marginTop: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}
