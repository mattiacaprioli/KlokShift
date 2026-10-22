import { useNavigate } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { VenueCard } from "../venues/VenueCard";
import { VenuesCard } from "../venues/VenuesCard";
import { CloseVenueSection } from "../venues/CloseVenueSection";
import { Button, PageHeader } from "../ui/primitives";

/**
 * Le sedi del titolare.
 *
 * Fino al 14/09/2026 questa pagina era la scheda della **sede attiva**, con
 * l'elenco delle altre in coda. Non c'è più una sede attiva: con una sede sola
 * la pagina resta la sua scheda (non c'è altro da mostrare), con più sedi
 * diventa l'elenco, e la scheda di ciascuno vive su `/sede/:id`.
 */
export function SedePage() {
  const { venues, can, canAny, isOwner } = useOwnerVenues();
  const navigate = useNavigate();

  if (venues.length === 0) {
    return (
      <>
        <PageHeader
          title="Nessuna sede"
          subtitle="Serve una sede per organizzare i turni e gestire il personale."
        />
        <NoVenues detail="Serve per organizzare i turni e gestire il personale." />
        {/* Chi ha chiuso l'unica sede deve poterla riaprire da qui. */}
        {isOwner ? (
          <div className="mx-auto mt-6 max-w-2xl">
            <VenuesCard />
          </div>
        ) : null}
      </>
    );
  }

  if (venues.length === 1) {
    // I dati della sede sono un permesso a sé: un collaboratore entrato per i
    // turni la vede — deve sapere dove lavora — ma non la scrive. Come il
    // Profilo dell'app, che a lui nasconde «Modifica sede».
    const editable = can(venues[0].id, "can_manage_venue");
    const clockEditable = can(venues[0].id, "can_view_hours");
    return (
      <>
        <PageHeader
          title="Sede"
          subtitle={
            editable || clockEditable
              ? "Come si presenta la sede e come ci si lavora."
              : "Questi dati sono ciò che i professionisti vedono della sede."
          }
          // Con una sede sola l'elenco ripeterebbe la scheda: resta l'azione.
          // Aprire una sede non si delega, quindi solo al titolare.
          actions={
            isOwner ? (
              <Button onClick={() => navigate("/sede/nuovo")}>
                + Aggiungi sede
              </Button>
            ) : null
          }
        />
        <VenueCard
          venue={venues[0]}
          editable={editable}
          clockEditable={clockEditable}
        />
        <CloseVenueSection venue={venues[0]} />
        {/* Le sedi chiuse da riaprire, se ce ne sono. */}
        {isOwner ? (
          <div className="mt-8 max-w-4xl">
            <VenuesCard />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Le tue sedi"
        subtitle={
          canAny("can_manage_venue")
            ? "Apri una sede per modificarne la scheda."
            : "Apri una sede per vederne la scheda."
        }
      />
      <VenuesCard />
    </>
  );
}
