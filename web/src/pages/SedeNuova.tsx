import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { canCreateVenue } from "@/features/venues/gate";
import { VenueFormCard } from "../venues/VenueFormCard";
import { PageHeader, Placeholder } from "../ui/primitives";

/**
 * Creazione di una sede: la prima, o la terza.
 *
 * Con `(manager)/venue/new.tsx` è uno dei **due soli** punti che chiamano
 * `canCreateVenue` (vedi `features/venues/gate.ts`). Non c'è niente da attivare
 * dopo il salvataggio: la sede nuova entra in `venues` e compare da sé nel
 * planning, nell'organico e nel picker del form turno.
 *
 * `plan` si legge da `profile` invece di `usePlan()` perché quell'hook importa
 * `expo-router`, che qui non esiste.
 */
export function SedeNuovaPage() {
  const { profile } = useAuth();
  const { venues } = useOwnerVenues();
  const navigate = useNavigate();

  const gate = canCreateVenue({
    venueCount: venues.length,
    plan: profile?.plan === "free" ? "free" : "pro",
  });

  if (!gate.allowed) {
    return (
      <>
        <PageHeader title="Nuova sede" />
        <Placeholder title="Più sedi è una funzione Pro" detail={gate.reason} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Nuova sede"
        subtitle={
          venues.length > 0
            ? "Una sede in più: avrà un suo organico, i suoi ruoli e i suoi turni. Le persone che hai già le potrai aggiungere anche qui."
            : "Serve per pubblicare turni e gestire il personale."
        }
      />
      <VenueFormCard venue={null} onSaved={() => navigate("/sede")} />
    </>
  );
}
