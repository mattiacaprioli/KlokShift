import { useNavigate } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import {
  useMyClosedVenues,
  useSetVenueClosed,
} from "@/features/venues/hooks";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { Button, Card } from "../ui/primitives";

/**
 * Tutte le sedi del titolare, aperti e chiusi.
 *
 * Non c'è più una sede "attiva" da scegliere: la riga apre la scheda, e basta.
 * Il pallino colorato è lo stesso con cui quella sede si riconosce nel planning —
 * questo è l'unico posto in cui quella legenda si può imparare.
 *
 * Con una sede sola la sua scheda è già la pagina (`SedePage`), e «Aggiungi
 * sede» sta nell'intestazione: qui restano solo le sedi chiuse da riaprire, e
 * se non ce ne sono la card non si vede.
 */
export function VenuesCard() {
  // Aprire una sede resta del titolare: un collaboratore vede l'elenco, non il
  // bottone. La difesa vera è il trigger `venues_owner_not_delegate`.
  // ⚠️ Le sedi chiuse sono dell'**azienda**: fino al 17/10/2026 qui passava
  // l'id dell'account, la query cercava `workspace_id = <utente>` e «Sedi
  // chiuse» restava vuota per sempre — una sede chiusa non si riapriva più.
  const { venues, isOwner, workspaceId } = useOwnerVenues();
  const closed = useMyClosedVenues(workspaceId ?? "").data ?? [];
  const setClosed = useSetVenueClosed(workspaceId ?? "");
  const navigate = useNavigate();
  const toast = useToast();

  function reopen(venueId: string, name: string) {
    setClosed.mutate(
      { venueId, closed: false },
      {
        onSuccess: () => toast.show(`${name} riaperta`),
        onError: () => toast.show("Impossibile riaprire. Riprova.", "error"),
      }
    );
  }

  const closedList = closed.length > 0 ? (
    <ul className="mt-2 flex flex-col gap-2">
      {closed.map((v) => (
        <li
          key={v.id}
          className="flex items-center gap-3 rounded-xl border border-border-2 px-3 py-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-t3">
            {v.name}
          </span>
          <Button
            disabled={setClosed.isPending}
            onClick={() => reopen(v.id, v.name)}
          >
            Riapri
          </Button>
        </li>
      ))}
    </ul>
  ) : null;

  // Con zero o una sede aperta «Aggiungi sede» sta già sulla pagina: qui
  // restano solo le sedi chiuse.
  const single = venues.length <= 1;
  if (single && closed.length === 0) return null;

  if (single) {
    return (
      <Card>
        <details>
          <summary className="cursor-pointer text-xs text-t3">
            Sedi chiuse · {closed.length}
          </summary>
          {closedList}
        </details>
      </Card>
    );
  }

  // Più sedi: una griglia di schede, così lo schermo largo si riempie di sedi
  // e non di vuoto. La barretta in alto è il colore della sede nel planning.
  return (
    <div className="flex max-w-7xl flex-col gap-6">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {venues.map((v, i) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => navigate(`/sede/${v.id}`)}
              className="focus-gold group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-card text-left transition hover:border-border-gold hover:bg-bg-1"
            >
              <span aria-hidden className="h-1 w-full" style={{ backgroundColor: venueAccent(i) }} />
              <span className="flex flex-1 flex-col gap-4 p-5">
                <span className="flex items-center gap-4">
                  <Avatar url={v.logo_url} name={v.name} size={52} />
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold text-t1">{v.name}</span>
                    {v.city ? <span className="block truncate text-sm text-t3">{v.city}</span> : null}
                  </span>
                </span>
                {v.address ? <span className="block text-sm text-t3">{v.address}</span> : null}
                <span className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
                  <span className="flex items-center gap-2 text-t3">
                    <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: venueAccent(i) }} />
                    Colore nei turni
                  </span>
                  <span className="font-semibold text-gold transition group-hover:translate-x-0.5">Apri la scheda ›</span>
                </span>
              </span>
            </button>
          </li>
        ))}
        {isOwner ? (
          <li>
            <button
              type="button"
              onClick={() => navigate("/sede/nuovo")}
              className="focus-gold flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-2 text-t3 transition hover:border-border-gold hover:text-gold"
            >
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-bg-2 text-xl">+</span>
              <span className="text-sm font-semibold">Aggiungi sede</span>
            </button>
          </li>
        ) : null}
      </ul>

      {closed.length > 0 ? (
        <Card>
          <details>
            <summary className="cursor-pointer text-xs text-t3">
              Sedi chiuse · {closed.length}
            </summary>
            {closedList}
          </details>
        </Card>
      ) : null}
    </div>
  );
}
