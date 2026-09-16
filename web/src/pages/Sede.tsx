import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { NoVenues } from "../venues/NoVenues";
import { VenueFormCard } from "../venues/VenueFormCard";
import { VenueInfoCard } from "../venues/VenueInfoCard";
import { VenuesCard } from "../venues/VenuesCard";
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
    return (
      <>
        <PageHeader
          title="Sede"
          subtitle={
            editable
              ? "Questi dati sono ciò che i professionisti vedono di te."
              : "Questi dati sono ciò che i professionisti vedono della sede."
          }
        />
        {editable ? (
          <VenueFormCard venue={venues[0]} />
        ) : (
          <VenueInfoCard venue={venues[0]} />
        )}
        {/* Con una sede sola l'elenco ripete la scheda che sta già sopra: al
            titolare serve lo stesso, perché è da lì che se ne apre una seconda
            (e che si riaprono quelle chiuse). A un collaboratore no — e la riga
            era pure tappabile, quindi portava a una pagina identica senza più
            l'elenco: sembrava che la scheda sparisse. */}
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
