import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { DocumentFormView } from "@/features/documents/DocumentFormView";
import { useCreateStaffDocument } from "@/features/documents/hooks";

/**
 * Aggiunta di un documento, lato professionista. `personId` è l'anagrafica che un
 * datore di lavoro ha di lui: una per titolare, valida per tutte le sue sedi. Non
 * è una cartella personale unica — ogni datore vede solo la propria.
 */
export default function NewWaiterDocumentScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const create = useCreateStaffDocument(personId);

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
            { uploadedBy: session!.user.id, meta: { name, expires_at }, file },
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
