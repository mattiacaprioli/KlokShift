import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/lib/auth";
import { useMyVenues } from "./hooks";
import {
  loadActiveVenueId,
  saveActiveVenueId,
} from "@/features/venues/activeVenueStorage";
import type { Venue } from "./api";

/**
 * La sede su cui il titolare sta lavorando adesso.
 *
 * Giuseppe ha un locale a Roma, uno a Milano e uno a Como: le schermate non
 * cambiano, cambia quale sede guardano. Questo provider è l'unico posto che lo sa,
 * e le schermate continuano a ricevere un `venue`/`venueId` come prima.
 *
 * ⚠️ **Cambiare sede non deve invalidare niente.** Tutte le chiavi di
 * `src/lib/queryKeys.ts` sono già scopate per `venueId`: cambiando sede cambiano i
 * parametri degli hook, React Query va a prendere le chiavi dell'altra sede e
 * **tiene in cache quelle della prima**, così tornare indietro è istantaneo.
 * Mettere un `queryClient.clear()` qui dentro è la tentazione ovvia ed è un
 * regresso: butterebbe via proprio quello che rende il passaggio immediato.
 *
 * ⚠️ `reactCompiler: true` (`app.json`): nessun hook condizionale, nessun early
 * return prima degli hook.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa verbatim, e
 * la persistenza passa da un alias (vedi `activeVenueStorage.ts`).
 */
export type ActiveVenueState = {
  /** Le sedi aperte, la più vecchia prima. Vuota per chi non è un titolare. */
  venues: Venue[];
  /** La sede attiva. `null` solo se il titolare non ha (ancora) nessuna sede. */
  venue: Venue | null;
  /**
   * `undefined` finché lista e preferenza non sono entrambe risolte. Tutti gli
   * hook del repo sono già `enabled: !!venueId`, quindi in quella finestra nessuna
   * query parte — e soprattutto nessuna parte sulla sede **sbagliata**, che è il
   * modo in cui si vedrebbe lampeggiare l'organico di Roma aprendo Milano.
   */
  venueId: string | undefined;
  setActiveVenue: (venueId: string) => void;
  /** Gli stessi nomi di `UseQueryResult`: i call site cambiano una riga. */
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

const ActiveVenueContext = createContext<ActiveVenueState | null>(null);

export function useActiveVenue(): ActiveVenueState {
  const ctx = useContext(ActiveVenueContext);
  if (!ctx) {
    throw new Error(
      "useActiveVenue deve essere usato dentro <ActiveVenueProvider />"
    );
  }
  return ctx;
}

/** Per chi vuole solo l'id da passare a un hook già scopato per sede. */
export function useActiveVenueId(): string | undefined {
  return useActiveVenue().venueId;
}

export function ActiveVenueProvider({ children }: PropsWithChildren) {
  const { session, profile } = useAuth();
  // Solo i gestori hanno sedi. `""` spegne la query, che è come RealtimeSync
  // faceva con `useMyVenue` — qui però lo sa il provider, non ogni chiamante.
  const ownerId =
    profile?.role === "manager" ? (session?.user.id ?? "") : "";

  const query = useMyVenues(ownerId);
  // Memoizzato e non `query.data ?? []` inline: quel fallback crea un array nuovo
  // a ogni render, che finirebbe nelle dipendenze del `useMemo` sotto e nel valore
  // del context — rifacendo render a tutte le schermate del gestore per niente.
  const venues = useMemo(() => query.data ?? [], [query.data]);

  // La preferenza letta dal disco, **insieme all'account a cui appartiene**.
  // Tenerli appaiati è ciò che permette di derivare `savedId` invece di azzerarlo
  // in un effect quando si cambia account: un `setState` sincrono nel corpo di un
  // effect è un giro di render in più, e il lint di React lo vieta.
  const [saved, setSaved] = useState<{
    ownerId: string;
    id: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadActiveVenueId(ownerId).then((id) => {
      if (alive) setSaved({ ownerId, id });
    });
    return () => {
      alive = false;
    };
  }, [ownerId]);

  // `undefined` = non ancora letta *per questo account*. Distinguerlo da `null`
  // (letta, non c'era) è ciò che evita di scegliere una sede prima di sapere quale
  // l'utente aveva lasciato aperta.
  const savedId = saved?.ownerId === ownerId ? saved.id : undefined;
  const resolving = savedId === undefined || (!!ownerId && query.isPending);

  const venue = useMemo(() => {
    if (resolving) return null;
    // La sede persistita può non esistere più: chiusa, cancellata, o di un altro
    // account. Si cade sulla più vecchia, che è anche il default di chi entra la
    // prima volta.
    return venues.find((v) => v.id === savedId) ?? venues[0] ?? null;
  }, [resolving, venues, savedId]);

  // Se il fallback è scattato, si riscrive la preferenza sul disco: senza, ogni
  // avvio rifarebbe lo stesso giro a vuoto cercando una sede che non c'è più.
  // Solo scrittura, nessuno stato: `savedId` resta quello che è, e `venue` è già
  // giusto perché derivato.
  useEffect(() => {
    if (resolving || !venue || !ownerId || venue.id === savedId) return;
    void saveActiveVenueId(ownerId, venue.id);
  }, [resolving, venue, savedId, ownerId]);

  const setActiveVenue = useCallback(
    (venueId: string) => {
      setSaved({ ownerId, id: venueId });
      void saveActiveVenueId(ownerId, venueId);
    },
    [ownerId]
  );

  const value = useMemo<ActiveVenueState>(
    () => ({
      venues,
      venue,
      venueId: venue?.id,
      setActiveVenue,
      isPending: resolving,
      isLoading: resolving,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    }),
    [
      venues,
      venue,
      setActiveVenue,
      resolving,
      query.isError,
      query.error,
      query.refetch,
    ]
  );

  return (
    <ActiveVenueContext.Provider value={value}>
      {children}
    </ActiveVenueContext.Provider>
  );
}
