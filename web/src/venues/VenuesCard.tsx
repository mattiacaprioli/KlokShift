import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useActiveVenue } from "@/features/venues/ActiveVenue";
import { useAuth } from "@/lib/auth";
import {
  useMyClosedVenues,
  useSetVenueClosed,
} from "@/features/venues/hooks";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import { Button, Card } from "../ui/primitives";

/**
 * Tutte le sedi del titolare: quella attiva, le altre, e quelle chiuse.
 *
 * Qui si **gestiscono** le sedi; per *passarci* c'è lo switcher in sidebar, che è
 * a portata di mano da ogni pagina.
 */
export function VenuesCard() {
  const { session } = useAuth();
  const ownerId = session!.user.id;
  const { venue, venues, setActiveVenue } = useActiveVenue();
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
          {venues.length === 1 ? "Il tuo locale" : `I tuoi locali · ${venues.length}`}
        </span>
        <Button onClick={() => navigate("/locale/nuovo")}>
          + Aggiungi locale
        </Button>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {venues.map((v) => {
          const active = v.id === venue?.id;
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setActiveVenue(v.id)}
                className={cn(
                  "focus-gold flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                  active
                    ? "border-gold/40 bg-gold/10"
                    : "border-border-2 bg-bg-1 hover:bg-bg-2"
                )}
              >
                <Avatar url={v.logo_url} name={v.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      active ? "text-gold" : "text-t1"
                    )}
                  >
                    {v.name}
                  </span>
                  {v.city ? (
                    <span className="block truncate text-xs text-t4">
                      {v.city}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <span className="shrink-0 text-xs text-gold">attivo</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {closed.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-t3">
            Locali chiusi · {closed.length}
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
