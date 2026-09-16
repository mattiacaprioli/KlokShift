import { ActivityIndicator } from "react-native";
import { Text, View } from "@/tw";
import { QueryError } from "@/components/ui/QueryError";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AbsenceList } from "./AbsenceList";
import { usePersonAbsences } from "./hooks";

/**
 * Ferie, permessi e malattie di una persona, nella sua scheda.
 *
 * L'assenza è della persona e non della sede: la sezione è la stessa da
 * qualunque sede la si apra. La RLS la mostra solo a chi gestisce l'organico.
 */
export function PersonAbsencesSection({
  personId,
  onRecord,
}: {
  personId: string;
  /** Dove si registra un'assenza (malattia al telefono, ferie concordate). */
  onRecord: () => void;
}) {
  const query = usePersonAbsences(personId);
  const absences = query.data ?? [];

  return (
    <View>
      <SectionHeader
        title="Assenze"
        actionLabel="Registra assenza"
        onAction={onRecord}
      />
      {query.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="my-6" />
      ) : query.isError ? (
        <QueryError onRetry={() => query.refetch()} />
      ) : absences.length === 0 ? (
        <Text className="text-sm leading-5 text-t3">
          Nessuna assenza. Le richieste di ferie e permessi arrivano in chat;
          una malattia comunicata a voce la registri da qui.
        </Text>
      ) : (
        <AbsenceList absences={absences} mode="manager" />
      )}
    </View>
  );
}
