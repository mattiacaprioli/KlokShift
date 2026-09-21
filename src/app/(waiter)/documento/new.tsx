import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";
import { DocumentFormView } from "@/features/documents/DocumentFormView";
import { useCreateStaffDocument } from "@/features/documents/hooks";

/**
 * Aggiunta di un documento, lato professionista. `memberId` è l'appartenenza
 * (`workspace_members.id`) che ha con quell'azienda: una per azienda, valida
 * per tutte le sue sedi. Non è una cartella personale unica — ogni azienda vede
 * solo la propria.
 */
export default function NewWaiterDocumentScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const create = useCreateStaffDocument(memberId);

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6">
        <ScreenHeader eyebrow="Documenti" title="Nuovo documento" />
      </View>
      <DocumentFormView
        requireFile
        submitLabel="Aggiungi documento"
        pending={create.isPending}
        onSubmit={({ name, expires_at, file }) => {
          if (!file) return;
          create.mutate(
            { meta: { name, expires_at }, file },
            {
              onSuccess: () => {
                toast.show("Documento aggiunto");
                router.back();
              },
              onError: (e) =>
                toast.show(
                  e instanceof Error
                    ? e.message
                    : "Impossibile caricare il documento.",
                  "error"
                ),
            }
          );
        }}
      />
    </View>
  );
}
