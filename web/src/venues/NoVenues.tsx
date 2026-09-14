import { useNavigate } from "react-router-dom";
import { Button, Placeholder } from "../ui/primitives";

/**
 * Il titolare non ha (ancora) nessun locale.
 *
 * Controparte web di `src/features/venues/NoVenuesState.tsx`, e come quella non
 * è più un gate: fino al 14/09/2026 `AppLayout` bloccava tutta la dashboard
 * finché non esisteva una sede, perché ogni query era ancorata a `venue_id`.
 * Ora le pagine guardano tutte le sedi del titolare, quindi ognuna mostra questo
 * al posto del proprio contenuto.
 */
export function NoVenues({
  detail = "Crea il locale per iniziare a programmare i turni.",
}: {
  detail?: string;
}) {
  const navigate = useNavigate();
  return (
    <Placeholder
      title="Nessun locale collegato a questo account"
      detail={detail}
      action={
        <Button variant="gold" onClick={() => navigate("/locale/nuovo")}>
          Crea il locale
        </Button>
      }
    />
  );
}
