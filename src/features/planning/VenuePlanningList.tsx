import { useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, type ViewToken } from "react-native";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import type { DaySection } from "@/features/assignments/agenda";
import { formatDayLabel } from "@/lib/format";
import type { PlanningShift } from "./api";
import { PlanningShiftCard } from "./PlanningShiftCard";

export type PlanningSection = DaySection<PlanningShift>;

/**
 * L'agenda del **sede**, per giorno: chi lavora quando, in tutte le sedi in
 * cui il professionista è in organico.
 *
 * Presentazionale di proposito. Il calendario e il giorno da cui parte stanno
 * nella schermata che la ospita — `(waiter)/(tabs)/turni` li condivide con la
 * vista «I miei», e due liste che si contendono lo stesso calendario devono
 * leggerlo dallo stesso stato, non tenerne una copia per uno.
 */
export function VenuePlanningList({
  sections,
  isLoading,
  isError,
  onRetry,
  refreshing,
  onRefresh,
  onViewableItemsChanged,
  viewabilityConfig,
  showVenue,
  today,
  away,
  anchorDay,
  paddingBottom,
}: {
  sections: PlanningSection[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[] }) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
  /** Il nome della sede sulle card: solo per chi lavora in più di una. */
  showVenue: boolean;
  today: string;
  /** L'agenda non parte da oggi: cambia il testo del vuoto. */
  away: boolean;
  anchorDay: string;
  paddingBottom: number;
}) {
  /**
   * Quale turno mostra l'elenco per esteso. Uno alla volta: aperti tutti, la
   * settimana diventa una parete di nomi e il calendario sopra perde il senso.
   * Sta qui e non nella schermata perché è stato della lista, non della domanda
   * che la lista risponde.
   */
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) {
    return <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />;
  }
  if (isError) return <QueryError onRetry={onRetry} />;

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      keyExtractor={(item) => item.id}
      // `VirtualizedList` memoizza le celle: senza questo, aprire un turno non
      // ridisegnerebbe la card che si è appena toccata.
      extraData={openId}
      stickySectionHeadersEnabled
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      }
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      renderSectionHeader={({ section }) => (
        <View className="bg-bg-0 pb-2 pt-3">
          <Mono gold={section.date === today}>{section.title}</Mono>
        </View>
      )}
      renderItem={({ item }) => (
        <View className="pb-3">
          <PlanningShiftCard
            shift={item}
            showVenue={showVenue}
            expanded={openId === item.id}
            onToggle={() =>
              setOpenId((prev) => (prev === item.id ? null : item.id))
            }
          />
        </View>
      )}
      ListEmptyComponent={
        <View className="flex-1 justify-center">
          <EmptyState
            title={
              away ? "Nessun turno da qui in poi" : "Nessun turno programmato"
            }
            subtitle={
              away
                ? `Dal ${formatDayLabel(anchorDay).toLowerCase()} la sede non ha ancora programmato turni.`
                : "Qui vedi i turni della sede e chi ci lavora. Se non compare nulla, la sede non ha ancora programmato niente — oppure ha scelto di non condividere il planning con l'organico."
            }
          />
        </View>
      }
    />
  );
}
