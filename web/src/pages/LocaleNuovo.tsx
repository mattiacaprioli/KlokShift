import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { canCreateVenue } from "@/features/venues/gate";
import { VenueFormCard } from "../venues/VenueFormCard";
import { PageHeader, Placeholder } from "../ui/primitives";

/**
 * Creazione di un locale: il primo, o il terzo.
 *
 * Con `(manager)/venue/new.tsx` è uno dei **due soli** punti che chiamano
 * `canCreateVenue` (vedi `features/venues/gate.ts`). Appena creato diventa la sede
 * attiva: chi ha appena aperto Milano si aspetta di trovarsi a Milano.
 *
 * `plan` si legge da `profile` invece di `usePlan()` perché quell'hook importa
 * `expo-router`, che qui non esiste.
 */
export function LocaleNuovoPage() {
  const { profile } = useAuth();
  const { venues, setActiveVenue } = useActiveVenue();
  const navigate = useNavigate();

  const gate = canCreateVenue({
    venueCount: venues.length,
    plan: profile?.plan === "free" ? "free" : "pro",
  });

  if (!gate.allowed) {
    return (
      <>
        <PageHeader title="Nuovo locale" />
        <Placeholder title="Più locali è una funzione Pro" detail={gate.reason} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Nuovo locale"
        subtitle={
          venues.length > 0
            ? "Una sede in più: avrà un suo organico, i suoi ruoli e i suoi turni. Le persone che hai già le potrai aggiungere anche qui."
            : "Serve per pubblicare turni e gestire il personale."
        }
      />
      <VenueFormCard
        venue={null}
        onSaved={(created) => {
          setActiveVenue(created.id);
          navigate("/locale");
        }}
      />
    </>
  );
}
