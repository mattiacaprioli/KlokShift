import { useNavigate, useParams } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { VenueCard } from "../venues/VenueCard";
import { ClockMethodCard } from "../venues/ClockMethodCard";
import {
  Button,
  PageHeader,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

/**
 * La scheda di **una** sede.
 *
 * Gemella di `src/app/(manager)/venue/[id].tsx`: la sede si prende da
 * `venues.find(...)`, che è già in cache — aprirla non costa una query in più.
 */
export function SedeDettaglioPage() {
  const { id } = useParams<{ id: string }>();
  const { venues, can, isPending, isError, error } = useOwnerVenues();
  const navigate = useNavigate();
  const venue = venues.find((v) => v.id === id) ?? null;

  // Il ritorno va all'elenco, non a `navigate(-1)`: la scheda si apre anche da
  // un link diretto o dopo un refresh, e lì «indietro» uscirebbe dall'app.
  const back = <Button onClick={() => navigate("/sede")}>← Sedi</Button>;

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  if (!venue) {
    return (
      <>
        <PageHeader title="Sede non trovata" actions={back} />
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
        actions={back}
      />
      <VenueCard key={venue.id} venue={venue} editable={editable} />
      {can(venue.id, "can_view_hours") ? (
        <ClockMethodCard venue={venue} />
      ) : null}
    </>
  );
}
