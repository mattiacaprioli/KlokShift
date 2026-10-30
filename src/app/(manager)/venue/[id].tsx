import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { GhostButton } from "@/components/ui/GhostButton";
import { QueryError } from "@/components/ui/QueryError";
import { useToast } from "@/providers/Toast";
import { VenuePlanningToggle } from "@/features/planning/VenuePlanningToggle";
import { VenueBreakCard } from "@/features/clock/VenueBreakCard";
import { VenueClockMethodCard } from "@/features/clock/VenueClockMethodCard";
import { VenueClosuresCard } from "@/features/venues/VenueClosuresCard";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useSetVenueClosed } from "@/features/venues/hooks";
import { VenueFormView } from "@/features/venues/VenueFormView";
import { VenueInfoView } from "@/features/venues/VenueInfoView";

/**
 * Modifica di una sede, più la sua archiviazione.
 *
 * La sede arriva da `useOwnerVenues().venues`, che è già in cache: aprirla non
 * costa una query in più.
 */
export default function VenueEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { workspaceId, venues, can, isOwner, isLoading, isError, refetch } =
    useOwnerVenues();
  const close = useSetVenueClosed(workspaceId ?? "");
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
          title="Sede non trovata"
          subtitle="Potrebbe essere stato chiuso da un altro dispositivo."
        />
      </View>
    );
  }

  // Il permesso è per sede, quindi la domanda si fa qui: da `Profilo` ci si
  // arriva toccando la riga dell'elenco, che non sa cosa ci sia dietro. Senza
  // questo, un collaboratore invitato sui soli turni apriva il modulo di
  // modifica — e il pulsante «Chiudi questa sede».
  const canEditVenue = can(venue.id, "can_manage_venue");
  const canEditClock = can(venue.id, "can_view_hours");
  // Le chiusure le scrive chi organizza i turni o i dati della sede.
  const canEditClosures = can(venue.id, "can_manage_shifts") || canEditVenue;

  if (!canEditVenue) {
    return (
      <VenueInfoView
        venue={venue}
        footer={
          <View className="gap-6">
            <VenueClosuresCard venue={venue} canEdit={canEditClosures} />
            {canEditClock ? <VenueClockMethodCard venue={venue} /> : null}
            {canEditClock ? <VenueBreakCard venue={venue} /> : null}
          </View>
        }
      />
    );
  }

  function doClose() {
    close.mutate(
      { venueId: venue!.id, closed: true },
      {
        onSuccess: () => {
          setConfirmVisible(false);
          toast.show("Sede chiusa");
          router.back();
        },
        onError: () => {
          setConfirmVisible(false);
          toast.show("Impossibile chiudere la sede. Riprova.", "error");
        },
      }
    );
  }

  return (
    <>
      <VenueFormView
        venue={venue}
        workspaceId={workspaceId}
        onSaved={() => router.back()}
        footer={
          <View className="gap-6">
            <VenueClosuresCard venue={venue} canEdit={canEditClosures} />
            {canEditClock ? <VenueClockMethodCard venue={venue} /> : null}
            {canEditClock ? <VenueBreakCard venue={venue} /> : null}
            <VenuePlanningToggle venue={venue} ownerId={workspaceId ?? ""} />
            {/* Solo il titolare: `set_venue_closed` accetta lui e basta, e a
                un collaboratore con «Dati della sede» il pulsante finiva in
                «Impossibile chiudere la sede». */}
            {isOwner ? (
              <GhostButton
                label={close.isPending ? "Chiusura…" : "Chiudi questa sede"}
                disabled={close.isPending}
                onPress={() => setConfirmVisible(true)}
              />
            ) : null}
          </View>
        }
      />
      <ConfirmModal
        visible={confirmVisible}
        title={`Chiudere ${venue.name}?`}
        // "Chiudere" e non "eliminare", ed è una differenza sostanziale:
        // cancellare la riga cascaterebbe su turni, organico, assegnazioni e
        // ruoli, distruggendo ore già lavorate da altre persone. Chiudere lo
        // toglie dalla circolazione e lascia tutto consultabile.
        message="Sparisce dalla programmazione e non potrai più crearci turni. Lo storico di turni e ore resta consultabile, e puoi riaprirla quando vuoi dal Profilo, in «Sedi chiuse»."
        confirmLabel="Chiudi sede"
        destructive
        pending={close.isPending}
        onConfirm={doClose}
        onCancel={() => setConfirmVisible(false)}
      />
    </>
  );
}
