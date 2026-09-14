import { useParams } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueFormCard } from "../venues/VenueFormCard";
import { PageHeader, Placeholder, QueryError, Spinner } from "../ui/primitives";

/**
 * La scheda di **un** locale.
 *
 * Gemella di `src/app/(manager)/venue/[id].tsx`: la sede si prende da
 * `venues.find(...)`, che è già in cache — aprirla non costa una query in più.
 */
export function LocaleDettaglioPage() {
  const { id } = useParams<{ id: string }>();
  const { venues, isPending, isError, error } = useOwnerVenues();
  const venue = venues.find((v) => v.id === id) ?? null;

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  if (!venue) {
    return (
      <>
        <PageHeader title="Locale non trovato" />
        <Placeholder
          title="Questo locale non esiste più"
          detail="Potrebbe essere stato chiuso da un altro dispositivo."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={venue.name}
        subtitle="Questi dati sono ciò che i professionisti vedono di te."
      />
      <VenueFormCard venue={venue} />
    </>
  );
}
