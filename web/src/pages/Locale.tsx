import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useVenueOptional } from "../lib/venue";
import { VenueFormCard } from "../venues/VenueFormCard";
import { VenuesCard } from "../venues/VenuesCard";
import { Button, Card, PageHeader } from "../ui/primitives";

/**
 * La scheda della **sede attiva**, più l'elenco di tutte le sedi del titolare.
 *
 * Resta raggiungibile anche senza nessun locale (`VENUE_FREE` in `AppLayout`), ma
 * non è più il posto da cui si crea: quello è `/locale/nuovo`. Chi arriva qui a
 * mani vuote trova il pulsante per andarci.
 */
export function LocalePage() {
  const venue = useVenueOptional();
  const { venues } = useActiveVenue();
  const navigate = useNavigate();

  if (!venue) {
    return (
      <>
        <PageHeader
          title="Nessun locale"
          subtitle="Serve un locale per pubblicare turni e gestire il personale."
        />
        <Card className="max-w-2xl">
          <Button variant="gold" onClick={() => navigate("/locale/nuovo")}>
            Crea il tuo locale
          </Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={venues.length > 1 ? venue.name : "Locale"}
        subtitle="Questi dati sono ciò che i professionisti vedono di te."
      />

      <VenueFormCard venue={venue} />

      <div className={cn("mt-6 max-w-2xl")}>
        <VenuesCard />
      </div>
    </>
  );
}
