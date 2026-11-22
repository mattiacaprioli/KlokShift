import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { QueryError } from "@/components/ui/QueryError";
import { GhostButton } from "@/components/ui/GhostButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AbsenceList } from "./AbsenceList";
import { usePersonAbsences } from "./hooks";
import { useColors } from "@/lib/theme";

/**
 * Ferie, permessi e malattie di una persona, nella sua scheda.
 *
 * L'assenza è della persona e non della sede: la sezione è la stessa da
 * qualunque sede la si apra. La RLS la mostra solo a chi gestisce il team.
 */
export function PersonAbsencesSection({
  personId,
  onRecord,
  self,
}: {
  personId: string;
  /**
   * Dove si registra un'assenza (malattia al telefono, ferie concordate).
   * Assente: non la si può registrare da qui.
   */
  onRecord?: () => void;
  /**
   * La propria scheda. Il titolare le sue assenze le registra da sé; il
   * collaboratore le chiede, e qui non ha il pulsante (`is_restricted_self`).
   */
  self?: "owner" | "collaborator";
}) {
  const colors = useColors();
  const query = usePersonAbsences(personId);
  const absences = query.data ?? [];

  return (
    <View>
      <SectionHeader
        title="Assenze"
        actionLabel={onRecord ? "Registra assenza" : undefined}
        onAction={onRecord}
      />
      {query.isLoading ? (
        <ActivityIndicator color={colors.gold} className="my-6" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : absences.length === 0 ? (
        <Text className="text-sm leading-5 text-t3">
          {self === "owner"
            ? "Nessuna assenza. Le tue ferie, i permessi e la malattia li registri da qui: risultano subito approvati."
            : self === "collaborator"
              ? "Nessuna assenza. Le tue ferie e i permessi li chiedi al titolare da «Passa ai tuoi turni», nel Menu."
              : "Nessuna assenza. Ferie e permessi li chiede il dipendente dall’app; una malattia comunicata a voce la registri da qui."}
        </Text>
      ) : (
        <View className="gap-3">
          <AbsenceList absences={absences} mode="manager" />
          {query.hasNextPage ? (
            <GhostButton
              label={query.isFetchingNextPage ? "Caricamento…" : "Carica altre"}
              disabled={query.isFetchingNextPage}
              onPress={() => query.fetchNextPage()}
              size="sm"
              className="self-center"
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
