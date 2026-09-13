import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { Mono } from "@/components/ui/Mono";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useMyDocumentScopes } from "@/features/staff/hooks";
import { documentScopeLabel } from "@/features/staff/api";
import { DocumentsSection } from "@/features/documents/DocumentsSection";

/**
 * I documenti del professionista, **un elenco per datore di lavoro**.
 *
 * Non è una cartella personale unica: un documento sta sull'anagrafica che quel
 * datore ha di te, ed è l'unico modo in cui può tenerne una anche per chi l'app
 * non ce l'ha. Ma da 20260913100100 l'anagrafica è **una per titolare**, non per
 * sede: se Giuseppe ha tre locali e tu lavori in due, carichi l'HACCP una volta e
 * vale per entrambi. Lasciando una sola delle sue sedi i documenti restano; se
 * lasci l'ultima, spariscono con l'anagrafica.
 *
 * È una conseguenza che va detta in pagina, non scoperta.
 */
export default function WaiterDocumentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const query = useMyDocumentScopes(session!.user.id);
  const scopes = query.data ?? [];
  const pull = usePullToRefresh(query.refetch);

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
        HACCP, contratti, attestati. Li carichi una volta per datore di lavoro e
        valgono per tutte le sue sedi. Li vede solo lui, e li puoi aggiornare
        quando vuoi.
      </Text>

      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : scopes.length === 0 ? (
        <EmptyState
          title="Non fai ancora parte di un locale"
          subtitle="I documenti si caricano sull'anagrafica che il datore di lavoro ha di te: appena entri in un organico, li trovi qui."
        />
      ) : (
        scopes.map((scope) => (
          <View key={scope.id} className="gap-2">
            {/* Il nome delle sedi e non quello del titolare: è così che uno
                riconosce il posto in cui lavora. */}
            <Mono gold>{documentScopeLabel(scope)}</Mono>
            <DocumentsSection
              personId={scope.id}
              title="Documenti"
              onAdd={() =>
                router.push({
                  pathname: "/(waiter)/documento/new",
                  params: { personId: scope.id },
                })
              }
            />
          </View>
        ))
      )}
    </ScrollView>
  );
}
