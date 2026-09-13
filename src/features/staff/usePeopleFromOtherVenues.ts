import { useMemo } from "react";
import { useOwnerPeople } from "./hooks";
import type { OwnerPerson } from "./api";

/** Una persona che il titolare ha altrove, pronta da mostrare in elenco. */
export type ReusablePerson = {
  person: OwnerPerson;
  /** "Da Buffa · Bistrot Como" — dove lavora già. */
  venuesLabel: string;
};

/**
 * Le persone che il titolare ha in **altre** sedi e che non sono ancora in questa.
 *
 * È la risposta a "Marco lavora a Roma e da domani anche a Milano": senza questo
 * elenco l'unica strada sarebbe reinvitarlo per email, e il risultato sarebbe una
 * seconda anagrafica dello stesso Marco — che l'unique `staff_people (owner_id,
 * waiter_id)` per fortuna rifiuta, ma con un errore che non spiega niente.
 *
 * Logica pura e condivisa: la usano l'app e la dashboard, che mostrano lo stesso
 * elenco in due modi diversi.
 */
export function usePeopleFromOtherVenues(
  ownerId: string | undefined,
  venueId: string | undefined
) {
  const query = useOwnerPeople(ownerId);

  const people = useMemo<ReusablePerson[]>(() => {
    if (!venueId) return [];
    return (query.data ?? [])
      .filter((p) => !p.memberships.some((m) => m.venue_id === venueId))
      .map((p) => ({
        person: p,
        venuesLabel: p.memberships
          .map((m) => m.venue?.name)
          .filter((n): n is string => !!n)
          .sort((a, b) => a.localeCompare(b, "it"))
          .join(" · "),
      }));
  }, [query.data, venueId]);

  return { ...query, people };
}
