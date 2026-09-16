import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { AbsenceFormView } from "@/features/absences/AbsenceFormView";
import { useRecordAbsence } from "@/features/absences/hooks";

/**
 * Registrare un'assenza per conto di una persona dell'organico: la malattia
 * comunicata al telefono, le ferie concordate a voce, o chi l'app non ce l'ha.
 * Nasce già approvata, senza card in chat.
 */
export default function RecordStaffAbsenceScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const record = useRecordAbsence();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6">
        <ScreenHeader eyebrow="Assenze" title="Registra assenza" />
      </View>
      <AbsenceFormView
        recording
        submitLabel="Registra"
        pending={record.isPending}
        onSubmit={({ ownerId: _ownerId, ...input }) =>
          record.mutate(
            { personId, ...input },
            {
              onSuccess: () => {
                toast.show("Assenza registrata");
                router.back();
              },
              onError: (e) =>
                toast.show(
                  userErrorMessage(e, "Salvataggio non riuscito. Riprova."),
                  "error"
                ),
            }
          )
        }
      />
    </View>
  );
}
