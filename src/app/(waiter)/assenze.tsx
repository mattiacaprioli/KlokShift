import { useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { AbsenceList } from "@/features/absences/AbsenceList";
import {
  useMyAbsenceEmployers,
  useMyAbsences,
} from "@/features/absences/hooks";

/**
 * Ferie, permessi e malattia del professionista, presso tutti i datori di
 * lavoro. L'assenza è della persona e non della sede: una richiesta vale per
 * tutte le sedi dello stesso titolare.
 */
export default function WaiterAbsencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const waiterId = session!.user.id;
  const query = useMyAbsences(waiterId);
  const employersQuery = useMyAbsenceEmployers();
  const absences = query.data ?? [];
  const employers = employersQuery.data ?? [];
  const pull = usePullToRefresh(async () => {
    await Promise.all([query.refetch(), employersQuery.refetch()]);
  });

  // Il nome dell'azienda serve solo a chi lavora per più titolari.
  const labelByPerson = new Map(employers.map((e) => [e.memberId, e.label]));
  const subtitleFor =
    employers.length > 1
      ? (a: { member_id: string }) => labelByPerson.get(a.member_id) ?? null
      : undefined;

  const loading = query.isLoading || employersQuery.isLoading;

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 48,
        gap: 20,
      }}
      refreshControl={
        <RefreshControl
          tintColor="#EAB54C"
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      }
    >
      <ScreenHeader eyebrow="Turni · Assenze" title="Ferie e permessi" />

      <Text className="-mt-3 text-[13px] leading-5 text-t3">
        Chiedi ferie o un permesso, o comunica una malattia: il titolare riceve
        la richiesta in chat. I turni già assegnati non spariscono da soli, li
        sistema lui.
      </Text>

      {loading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : query.isError || employersQuery.isError ? (
        <QueryError
          onRetry={() => {
            query.refetch();
            employersQuery.refetch();
          }}
        />
      ) : employers.length === 0 ? (
        <EmptyState
          title="Non fai ancora parte di una sede"
          subtitle="Le assenze si chiedono al titolare che ti ha in organico: appena entri in una sede, le trovi qui."
        />
      ) : (
        <>
          <GoldButton
            label="Nuova richiesta"
            onPress={() => router.push("/(waiter)/assenza/new")}
          />
          {absences.length === 0 ? (
            <EmptyState
              title="Nessuna assenza"
              subtitle="Qui trovi le richieste inviate e la risposta del titolare."
            />
          ) : (
            <>
              <AbsenceList
                absences={absences}
                mode="mine"
                subtitleFor={subtitleFor}
              />
              {query.hasNextPage ? (
                <GhostButton
                  label={query.isFetchingNextPage ? "Caricamento…" : "Carica altre"}
                  disabled={query.isFetchingNextPage}
                  onPress={() => query.fetchNextPage()}
                  size="sm"
                  className="self-center"
                />
              ) : null}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
