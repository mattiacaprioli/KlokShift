import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/lib/auth";
import { useMyVenues } from "./hooks";
import type { Venue } from "./api";

/**
 * Le sedi del titolare. Tutte insieme, senza una "sede attiva".
 *
 * Fino al 14/09/2026 questo file era `ActiveVenue.tsx` e teneva **una** sede alla
 * volta: uno switcher in cima, e ogni schermata del gestore scopata su quella.
 * Per vedere i turni di Milano bisognava prima entrare in Milano.
 *
 * Era il verso sbagliato, e il database lo diceva già: `staff_people` è la
 * persona del **titolare**, `staff_members` è solo la sua appartenenza a una
 * sede. L'organico è dell'azienda; la sede è dove quella persona lavora quel
 * giorno. Adesso lo dice anche la UI: si guarda l'agenda dell'azienda, e la sede
 * è **un campo del turno** — un workspace, non un perimetro.
 *
 * Quindi qui non c'è più niente da scegliere: questo provider dice *quali* sedi
 * esistono, e i consumatori le usano tutte. Chi ha bisogno di una sede sola —
 * il form turno, la schermata dei ruoli — se la sceglie da sé con
 * `useLastVenue()`, che è una preferenza locale a quel form e non uno stato
 * globale.
 *
 * ⚠️ **Aprire o chiudere una sede non deve invalidare niente a mano.** Le chiavi
 * dei turni sono scopate per `venuesKey`: cambiando l'insieme delle sedi cambia
 * la chiave, React Query va a prendere quella nuova e tiene in cache la vecchia.
 * Un `queryClient.clear()` qui dentro è la tentazione ovvia ed è un regresso —
 * butterebbe via proprio la cache che rende immediata la vista unificata.
 *
 * ⚠️ `reactCompiler: true` (`app.json`): nessun hook condizionale, nessun early
 * return prima degli hook.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa verbatim.
 */
export type OwnerVenuesState = {
  /**
   * Il titolare, cioè **l'azienda**. `undefined` per chi non è un gestore.
   *
   * È il perimetro di tutto: i turni, l'organico, le ore del mese, l'export per
   * il commercialista. Sta qui perché il provider questo valore lo calcola già, e
   * i chiamanti altrimenti se lo ricavano ognuno per conto suo — da `useAuth()`
   * o da `venue.owner_id`, che però esiste solo se una sede esiste.
   */
  ownerId: string | undefined;
  /** Le sedi aperte, la più vecchia prima. Vuota per chi non è un titolare. */
  venues: Venue[];
  /** Gli id: è ciò che finisce in ogni `.in("venue_id", …)`. */
  venueIds: string[];
  /**
   * `venueIds` **ordinati** e uniti da una virgola: la porzione di query key che
   * cambia quando si apre o si chiude una sede. Ordinati di proposito — riaprire
   * una sede non deve produrre uno scope diverso da quello di prima e perdere la
   * cache per un'inversione di due id.
   *
   * È anche la dipendenza giusta per gli effetti (vedi `RealtimeSync`): una
   * stringa è stabile fra i render, `venueIds` no.
   */
  venuesKey: string;
  /** La sede di un turno, per il badge. O(1), invece di una `find` per card. */
  venueById: (id: string) => Venue | undefined;
  /** Più di una sede: l'interruttore di tutta la UI multi-sede. */
  isMultiVenue: boolean;
  /** Gli stessi nomi di `UseQueryResult`: i call site cambiano una riga. */
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

/** `[...ids].sort().join(",")` — vedi `venuesKey` in `OwnerVenuesState`. */
export function venuesKeyOf(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

const OwnerVenuesContext = createContext<OwnerVenuesState | null>(null);

export function useOwnerVenues(): OwnerVenuesState {
  const ctx = useContext(OwnerVenuesContext);
  if (!ctx) {
    throw new Error(
      "useOwnerVenues deve essere usato dentro <OwnerVenuesProvider />"
    );
  }
  return ctx;
}

/** Per chi vuole solo gli id da passare a una query già scopata per azienda. */
export function useVenueIds(): string[] {
  return useOwnerVenues().venueIds;
}

export function OwnerVenuesProvider({ children }: PropsWithChildren) {
  const { session, profile } = useAuth();
  // Solo i gestori hanno sedi. `""` spegne la query, che è come RealtimeSync
  // faceva con `useMyVenue` — qui però lo sa il provider, non ogni chiamante.
  const ownerId = profile?.role === "manager" ? (session?.user.id ?? "") : "";

  const query = useMyVenues(ownerId);
  // Memoizzato e non `query.data ?? []` inline: quel fallback crea un array nuovo
  // a ogni render, che finirebbe nelle dipendenze del `useMemo` sotto e nel valore
  // del context — rifacendo render a tutte le schermate del gestore per niente.
  const venues = useMemo(() => query.data ?? [], [query.data]);

  const byId = useMemo(() => {
    const map = new Map<string, Venue>();
    for (const v of venues) map.set(v.id, v);
    return map;
  }, [venues]);

  const venueById = useCallback((id: string) => byId.get(id), [byId]);

  const value = useMemo<OwnerVenuesState>(() => {
    const venueIds = venues.map((v) => v.id);
    return {
      ownerId: ownerId || undefined,
      venues,
      venueIds,
      venuesKey: venuesKeyOf(venueIds),
      venueById,
      isMultiVenue: venues.length > 1,
      isPending: !!ownerId && query.isPending,
      isLoading: !!ownerId && query.isPending,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    };
  }, [
    ownerId,
    venues,
    venueById,
    query.isPending,
    query.isError,
    query.error,
    query.refetch,
  ]);

  return (
    <OwnerVenuesContext.Provider value={value}>
      {children}
    </OwnerVenuesContext.Provider>
  );
}
