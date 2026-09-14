import { useRouter } from "expo-router";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueFormView } from "@/features/venues/VenueFormView";
import { canCreateVenue } from "@/features/venues/gate";
import { usePlan, PAYWALL_ROUTE } from "@/features/plan/hooks";

/**
 * Creazione di un locale: il primo, o il terzo.
 *
 * È l'**unico** punto dell'app che chiama `canCreateVenue` (vedi `gate.ts`).
 *
 * Non c'è più niente da "attivare" dopo il salvataggio: la sede appena aperta
 * entra in `venues`, e da lì compare da sé nell'agenda, nel picker del form
 * turno e nell'elenco del Profilo. Chi ha aperto Milano trova Milano ovunque
 * senza doverci entrare.
 */
export default function VenueNewScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const { venues } = useOwnerVenues();
  const plan = usePlan();

  const gate = canCreateVenue({ venueCount: venues.length, plan });

  if (!gate.allowed) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <EmptyState title="Più locali è una funzione Pro" subtitle={gate.reason} />
        <GoldButton
          className="mt-6"
          label="Scopri Pro"
          onPress={() => router.replace(PAYWALL_ROUTE)}
        />
      </View>
    );
  }

  return (
    <VenueFormView
      venue={null}
      ownerId={session!.user.id}
      title="Nuovo locale"
      intro={
        venues.length > 0
          ? "Una sede in più: avrà un suo organico, i suoi ruoli e i suoi turni. Le persone che hai già le potrai aggiungere anche qui."
          : "Queste informazioni saranno visibili ai professionisti sui tuoi turni."
      }
      onSaved={() => router.back()}
    />
  );
}
