import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { VenueFormCard } from "../venues/VenueFormCard";
import { VenuesCard } from "../venues/VenuesCard";
import { PageHeader } from "../ui/primitives";

/**
 * I locali del titolare.
 *
 * Fino al 14/09/2026 questa pagina era la scheda della **sede attiva**, con
 * l'elenco delle altre in coda. Non c'è più una sede attiva: con un locale solo
 * la pagina resta la sua scheda (non c'è altro da mostrare), con più locali
 * diventa l'elenco, e la scheda di ciascuno vive su `/locale/:id`.
 */
export function LocalePage() {
  const { venues } = useOwnerVenues();

  if (venues.length === 0) {
    return (
      <>
        <PageHeader
          title="Nessun locale"
          subtitle="Serve un locale per organizzare i turni e gestire il personale."
        />
        <NoVenues detail="Serve per organizzare i turni e gestire il personale." />
      </>
    );
  }

  if (venues.length === 1) {
    return (
      <>
        <PageHeader
          title="Locale"
          subtitle="Questi dati sono ciò che i professionisti vedono di te."
        />
        <VenueFormCard venue={venues[0]} />
        <div className="mt-6 max-w-2xl">
          <VenuesCard />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="I tuoi locali"
        subtitle="Apri un locale per modificarne la scheda."
      />
      <div className="max-w-2xl">
        <VenuesCard />
      </div>
    </>
  );
}
