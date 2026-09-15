import { useNavigate } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { venueAccent } from "@/features/venues/venueColor";
import { useAuth } from "@/lib/auth";
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
 */
export function VenuesCard() {
  const { session } = useAuth();
  const ownerId = session!.user.id;
  // Aprire una sede resta del titolare: un collaboratore vede l'elenco, non il
  // bottone. La difesa vera è il trigger `venues_owner_not_delegate`.
  const { venues, isOwner } = useOwnerVenues();
  const closed = useMyClosedVenues(ownerId).data ?? [];
  const setClosed = useSetVenueClosed(ownerId);
  const navigate = useNavigate();
  const toast = useToast();

  function reopen(venueId: string, name: string) {
    setClosed.mutate(
      { venueId, closed: false },
      {
        onSuccess: () => toast.show(`${name} riaperto`),
        onError: () => toast.show("Impossibile riaprire. Riprova.", "error"),
      }
    );
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-t3">
          {venues.length === 1 ? "La tua sede" : `Le tue sedi · ${venues.length}`}
        </span>
        {isOwner ? (
          <Button onClick={() => navigate("/sede/nuovo")}>
            + Aggiungi sede
          </Button>
        ) : null}
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {venues.map((v, i) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => navigate(`/sede/${v.id}`)}
              className="focus-gold flex w-full items-center gap-3 rounded-xl border border-border-2 bg-bg-1 px-3 py-2.5 text-left transition hover:bg-bg-2"
            >
              <Avatar url={v.logo_url} name={v.name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-t1">
                  {v.name}
                </span>
                {v.city ? (
                  <span className="block truncate text-xs text-t4">
                    {v.city}
                  </span>
                ) : null}
              </span>
              {venues.length > 1 ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: venueAccent(i) }}
                />
              ) : null}
              <span aria-hidden className="shrink-0 text-t3">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      {closed.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-t3">
            Sedi chiuse · {closed.length}
          </summary>
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
        </details>
      ) : null}
    </Card>
  );
}
