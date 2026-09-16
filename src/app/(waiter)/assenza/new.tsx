import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { AbsenceFormView } from "@/features/absences/AbsenceFormView";
import {
  useMyAbsenceEmployers,
  useRequestAbsence,
} from "@/features/absences/hooks";

/** Nuova richiesta di ferie o permesso, o malattia comunicata. */
export default function NewWaiterAbsenceScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const employersQuery = useMyAbsenceEmployers(session!.user.id);
  const request = useRequestAbsence();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6">
        <ScreenHeader eyebrow="Assenze" title="Nuova richiesta" />
      </View>
      {employersQuery.isLoading ? (
        <ActivityIndicator color="#EAB54C" className="mt-10" />
      ) : employersQuery.isError ? (
        <View className="px-6">
          <QueryError onRetry={() => employersQuery.refetch()} />
        </View>
      ) : (
        <AbsenceFormView
          employers={employersQuery.data ?? []}
          submitLabel="Invia al titolare"
          pending={request.isPending}
          onSubmit={({ ownerId, ...input }) => {
            if (!ownerId) return;
            request.mutate(
              { ownerId, ...input },
              {
                onSuccess: () => {
                  toast.show(
                    input.kind === "malattia"
                      ? "Malattia comunicata"
                      : "Richiesta inviata"
                  );
                  router.back();
                },
                onError: (e) =>
                  toast.show(
                    userErrorMessage(e, "Invio non riuscito. Riprova."),
                    "error"
                  ),
              }
            );
          }}
        />
      )}
    </View>
  );
}
