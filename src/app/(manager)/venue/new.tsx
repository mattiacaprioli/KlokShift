import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueFormView } from "@/features/venues/VenueFormView";
import { canCreateVenue, venueNewMode } from "@/features/venues/gate";

/**
 * Creazione di una sede: la prima, o la terza.
 *
 * È l'**unico** punto dell'app che chiama `canCreateVenue` (vedi `gate.ts`).
 *
 * Non c'è più niente da "attivare" dopo il salvataggio: la sede appena aperta
 * entra in `venues`, e da lì compare da sé nell'agenda, nel picker del form
 * turno e nell'elenco del Profilo. Chi ha aperto Milano trova Milano ovunque
 * senza doverci entrare.
 *
 * ⚠️ «Prima azienda» solo con il contesto caricato e vuoto (`venueNewMode`):
 * un contesto in errore non deve mai portare a `create_workspace`.
 */
export default function VenueNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    venues,
    workspaceId,
    access,
    accessPending,
    isOwner,
    isPending,
    isError,
    refetch,
  } = useOwnerVenues();

  const mode = venueNewMode({
    isPending,
    isError,
    workspaceId,
    isOwner,
    accessPending,
  });

  if (mode === "loading") {
    return (
      <View
        className="flex-1 bg-bg-0 px-5"
        style={{ paddingTop: insets.top + 24 }}
      >
        <SkeletonGroup className="gap-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </SkeletonGroup>
      </View>
    );
  }

  if (mode === "error") {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <QueryError onRetry={() => void refetch()} />
      </View>
    );
  }

  if (mode === "denied") {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <EmptyState
          title="Solo il titolare può aggiungere una sede"
          subtitle="Come collaboratore puoi lavorare sulle sedi su cui ti hanno dato accesso."
        />
      </View>
    );
  }

  const firstWorkspace = mode === "first";
  const gate = canCreateVenue({ access, firstWorkspace });

  if (!gate.allowed) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <EmptyState title="Nuova sede non disponibile" subtitle={gate.reason} />
      </View>
    );
  }

  return (
    <VenueFormView
      venue={null}
      workspaceId={workspaceId}
      firstWorkspace={firstWorkspace}
      title="Nuova sede"
      intro={
        venues.length > 0
          ? "Una sede in più: avrà un suo organico, i suoi ruoli e i suoi turni. Le persone che hai già le potrai aggiungere anche qui."
          : "Queste informazioni saranno visibili ai professionisti sui tuoi turni."
      }
      onSaved={() => router.back()}
    />
  );
}
