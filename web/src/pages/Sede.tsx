import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { VenueCard } from "../venues/VenueCard";
import { VenuesCard } from "../venues/VenuesCard";
import { ClockMethodCard } from "../venues/ClockMethodCard";
import { PageHeader } from "../ui/primitives";

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

  if (venues.length === 0) {
    return (
      <>
        <PageHeader
          title="Nessuna sede"
          subtitle="Serve una sede per organizzare i turni e gestire il personale."
        />
        <NoVenues detail="Serve per organizzare i turni e gestire il personale." />
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
            editable
              ? "Qui trovi i dati della sede. Usa Modifica per aggiornare dati e impostazioni."
              : "Questi dati sono ciò che i professionisti vedono della sede."
          }
        />
        <VenueCard
          venue={venues[0]}
          editable={editable}
          clockEditable={clockEditable}
        />
        {/* Chi può gestire i dati trova questa impostazione dentro «Modifica».
            Un collaboratore con il solo permesso Ore deve però conservarne
            l'accesso anche se non può aprire il modulo anagrafico. */}
        {!editable && clockEditable ? (
          <ClockMethodCard venue={venues[0]} />
        ) : null}
        {/* Con una sede sola l'elenco ripeterebbe la scheda che sta già sopra:
            `VenuesCard` allora non la elenca e resta solo «Aggiungi sede» (e le
            sedi chiuse da riaprire). Al titolare serve, a un collaboratore no:
            aprire una sede non si delega. */}
        {isOwner ? (
          <div className="mt-6 max-w-2xl">
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
      <div className="max-w-2xl">
        <VenuesCard />
      </div>
    </>
  );
}
