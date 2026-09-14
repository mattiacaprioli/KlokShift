import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { QueryError } from "@/components/ui/QueryError";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useSetVenueClosed } from "@/features/venues/hooks";
import { VenueFormView } from "@/features/venues/VenueFormView";

/**
 * Modifica di una sede, più la sua archiviazione.
 *
 * La sede arriva da `useOwnerVenues().venues`, che è già in cache: aprirla non
 * costa una query in più.
 */
export default function VenueEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const ownerId = session!.user.id;
  const { venues, isLoading, isError, refetch } = useOwnerVenues();
  const close = useSetVenueClosed(ownerId);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const venue = venues.find((v) => v.id === id) ?? null;

  if (isLoading) return <View className="flex-1 bg-bg-0" />;

  if (isError) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <QueryError onRetry={() => void refetch()} />
      </View>
    );
  }

  if (!venue) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <EmptyState
          title="Locale non trovato"
          subtitle="Potrebbe essere stato chiuso da un altro dispositivo."
        />
      </View>
    );
  }

  function doClose() {
    close.mutate(
      { venueId: venue!.id, closed: true },
      {
        onSuccess: () => {
          setConfirmVisible(false);
          toast.show("Locale chiuso");
          router.back();
        },
        onError: () => {
          setConfirmVisible(false);
          toast.show("Impossibile chiudere il locale. Riprova.", "error");
        },
      }
    );
  }

  return (
    <>
      <VenueFormView
        venue={venue}
        ownerId={ownerId}
        onSaved={() => router.back()}
        footer={
          <GhostButton
            label={close.isPending ? "Chiusura…" : "Chiudi questo locale"}
            disabled={close.isPending}
            onPress={() => setConfirmVisible(true)}
          />
        }
      />
      <ConfirmModal
        visible={confirmVisible}
        title={`Chiudere ${venue.name}?`}
        // "Chiudere" e non "eliminare", ed è una differenza sostanziale:
        // cancellare la riga cascaterebbe su turni, organico, assegnazioni e
        // ruoli, distruggendo ore già lavorate da altre persone. Chiudere lo
        // toglie dalla circolazione e lascia tutto consultabile.
        message="Sparisce dallo switcher e non potrai più programmarci turni. Lo storico di turni e ore resta consultabile, e puoi riaprirlo quando vuoi."
        confirmLabel="Chiudi locale"
        onConfirm={doClose}
        onCancel={() => setConfirmVisible(false)}
      />
    </>
  );
}
