import { useMemo } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { AbsenceList } from "@/features/absences/AbsenceList";
import { COMPANY_ABSENCES_DAYS_BACK } from "@/features/absences/api";
import { useCompanyAbsences } from "@/features/absences/hooks";
import { groupCompanyAbsences } from "@/features/absences/labels";

/**
 * Ferie, permessi e malattie di tutta l'azienda: da decidere, in corso e
 * prossime, passate da poco.
 *
 * Una pagina dentro Staff e non una tab: le assenze arrivano poche volte al
 * mese, e una tab vuota quasi sempre ruberebbe il posto a Turni e Messaggi. Il
 * richiamo quotidiano resta il blocco «Richieste» della home e il badge sulla
 * tab Staff.
 *
 * ⚠️ Gemello web in `web/src/pages/Assenze.tsx`.
 */
export default function ManagerAbsencesScreen() {
  const insets = useSafeAreaInsets();
  const { canAny } = useOwnerVenues();
  // Con il solo permesso Turni la RLS non restituisce nessuna riga: meglio dirlo
  // che mostrare «Nessuna assenza».
  const canStaff = canAny("can_manage_staff");
  const query = useCompanyAbsences(canStaff);
  const pull = usePullToRefresh(query.refetch);

  const rows = query.data;
  const { pending, upcoming, closed } = useMemo(
    () => groupCompanyAbsences(rows ?? []),
    [rows]
  );
  const nameByPerson = useMemo(
    () => new Map((rows ?? []).map((a) => [a.person_id, a.person?.full_name])),
    [rows]
  );
  const nameFor = (a: { person_id: string }) =>
    nameByPerson.get(a.person_id) ?? "Persona";

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
      <ScreenHeader eyebrow="Organico" title="Assenze" />

      {!canStaff ? (
        <EmptyState
          title="Non gestisci l'organico"
          subtitle="Le assenze le vede chi ha il permesso sull'organico. Nel planning trovi comunque chi non è disponibile."
        />
      ) : query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : pending.length + upcoming.length + closed.length === 0 ? (
        <EmptyState
          title="Nessuna assenza"
          subtitle="Le richieste di ferie e permessi arrivano in chat e compaiono qui. Una malattia comunicata a voce la registri dalla scheda della persona."
        />
      ) : (
        <>
          {pending.length > 0 ? (
            <View>
              <SectionHeader title={`Da decidere · ${pending.length}`} />
              <AbsenceList absences={pending} mode="manager" titleFor={nameFor} />
            </View>
          ) : null}

          <View>
            <SectionHeader title="In corso e prossime" />
            {upcoming.length > 0 ? (
              <AbsenceList absences={upcoming} mode="manager" titleFor={nameFor} />
            ) : (
              <Text className="text-sm text-t3">
                Nessuna assenza approvata in arrivo.
              </Text>
            )}
          </View>

          {closed.length > 0 ? (
            <View>
              <SectionHeader title="Passate e chiuse" />
              <AbsenceList absences={closed} mode="manager" titleFor={nameFor} />
            </View>
          ) : null}
        </>
      )}

      {canStaff ? (
        <Text className="text-xs leading-4 text-t3">
          Qui trovi gli ultimi {COMPANY_ABSENCES_DAYS_BACK} giorni: lo storico
          completo di ogni persona è nella sua scheda, in Staff.
        </Text>
      ) : null}
    </ScrollView>
  );
}
