import { useRouter } from "expo-router";
import { RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { DocumentsSection } from "@/features/documents/DocumentsSection";

/**
 * I documenti del professionista, **un elenco per azienda**.
 *
 * Ogni `workspace_members` che ho è un'appartenenza a un'azienda: un documento
 * sta lì, ed è l'unico modo in cui l'azienda può tenerne uno anche per chi
 * l'app non ce l'ha. Vale per tutte le sedi di quell'azienda: se Giuseppe ha
 * tre sedi e lavoro in due, carico l'HACCP una volta e vale per entrambe.
 */
export default function WaiterDocumentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { memberships, isPending, isError, refetch } = useOwnerVenues();
  const pull = usePullToRefresh(refetch);

  // Solo le appartenenze attive: un invito ancora da accettare non è un datore
  // di lavoro per cui caricare documenti.
  const active = memberships.filter((m) => m.status === "active");

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 48,
        gap: 24,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      }
    >
      <ScreenHeader eyebrow="Profilo · Privato" title="I tuoi documenti" />

      <Text className="-mt-4 text-[13px] leading-5 text-t3">
        HACCP, contratti, attestati. Li carichi una volta per azienda e valgono
        per tutte le sue sedi. Li vede solo lei, e li puoi aggiornare quando
        vuoi.
      </Text>

      {isPending ? null : isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : active.length === 0 ? (
        <EmptyState
          title="Non fai ancora parte di un'azienda"
          subtitle="I documenti si caricano sull'anagrafica che l'azienda ha di te: appena entri in un organico, li trovi qui."
        />
      ) : (
        active.map((m) => (
          <View key={m.member_id} className="gap-2">
            <Mono gold>{m.workspace_name}</Mono>
            <DocumentsSection
              memberId={m.member_id}
              title="Documenti"
              onAdd={() =>
                router.push({
                  pathname: "/(waiter)/documento/new",
                  params: { memberId: m.member_id },
                })
              }
            />
          </View>
        ))
      )}
    </ScrollView>
  );
}
