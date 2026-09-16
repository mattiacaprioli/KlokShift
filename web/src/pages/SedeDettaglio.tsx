import { useParams } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueFormCard } from "../venues/VenueFormCard";
import { VenueInfoCard } from "../venues/VenueInfoCard";
import { PageHeader, Placeholder, QueryError, Spinner } from "../ui/primitives";

/**
 * La scheda di **una** sede.
 *
 * Gemella di `src/app/(manager)/venue/[id].tsx`: la sede si prende da
 * `venues.find(...)`, che è già in cache — aprirla non costa una query in più.
 */
export function SedeDettaglioPage() {
  const { id } = useParams<{ id: string }>();
  const { venues, can, isPending, isError, error } = useOwnerVenues();
  const venue = venues.find((v) => v.id === id) ?? null;

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  if (!venue) {
    return (
      <>
        <PageHeader title="Sede non trovata" />
        <Placeholder
          title="Questa sede non esiste più"
          detail="Potrebbe essere stato chiuso da un altro dispositivo."
        />
      </>
    );
  }

  // Il permesso è **per sede**: con due sedi delegate un collaboratore può
  // scrivere l'una e non l'altra, quindi la domanda si fa qui e non sul menu.
  const editable = can(venue.id, "can_manage_venue");

  return (
    <>
      <PageHeader
        title={venue.name}
        subtitle={
          editable
            ? "Questi dati sono ciò che i professionisti vedono di te."
            : "Questi dati sono ciò che i professionisti vedono della sede."
        }
      />
      {editable ? (
        <VenueFormCard venue={venue} />
      ) : (
        <VenueInfoCard venue={venue} />
      )}
    </>
  );
}
