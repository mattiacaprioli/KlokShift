import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueFormView } from "@/features/venues/VenueFormView";
import { canCreateVenue, venueNewMode } from "@/features/venues/gate";

/**
 * Creazione di una sede: la prima, o la terza.
 *
 * È l'**unico** punto dell'app che chiama `canCreateVenue` (vedi `gate.ts`).
 *
 * Dopo la **prima** sede si passa a `prova` (l'azienda nasce in `setup`).
 * Per le successive non c'è niente da "attivare": la sede appena aperta
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

  const firstWorkspace = mode === "first";
  const gate = canCreateVenue({ access, firstWorkspace });

  if (mode === "loading" || mode === "error" || mode === "denied" || !gate.allowed) {
    return (
      <View
        className="flex-1 bg-bg-0 px-5"
        style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom }}
      >
        <ScreenHeader
          eyebrow="Sede"
          title="Nuova sede"
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(manager)/(tabs)/profilo");
          }}
        />
        <View className={mode === "loading" ? "mt-6" : "flex-1 justify-center"}>
          {mode === "loading" ? (
            <SkeletonGroup className="gap-4">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </SkeletonGroup>
          ) : mode === "error" ? (
            <QueryError onRetry={() => void refetch()} />
          ) : mode === "denied" ? (
            <EmptyState
              title="Solo il titolare può aggiungere una sede"
              subtitle="Come collaboratore puoi lavorare sulle sedi su cui ti hanno dato accesso."
            />
          ) : !gate.allowed ? (
            <EmptyState title="Nuova sede non disponibile" subtitle={gate.reason} />
          ) : null}
        </View>
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
          ? "Una sede in più: avrà il suo team, i suoi ruoli e i suoi turni. Le persone che hai già le potrai aggiungere anche qui."
          : "Serve solo il nome: lo vede il tuo team sui turni. Il resto puoi completarlo dopo."
      }
      // La prima sede apre l'ultimo passo del setup: la prova. Senza, il
      // titolare si troverebbe persone e turni chiusi senza sapere perché.
      onSaved={() =>
        firstWorkspace ? router.replace("/(manager)/prova") : router.back()
      }
    />
  );
}
