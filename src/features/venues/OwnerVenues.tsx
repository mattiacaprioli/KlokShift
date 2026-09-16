import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/lib/auth";
import { useMyVenueAccess } from "@/features/team/hooks";
import type { TeamPermission } from "@/features/team/api";
import { useMyVenues } from "./hooks";
import type { Venue } from "./api";

/**
 * Le sedi dell'azienda. Tutte insieme, senza una "sede attiva".
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
 * Dal 16/09/2026 dice anche **cosa** si può fare su ciascuna: chi entra qui può
 * essere il titolare (che può tutto) o un collaboratore che il titolare ha
 * invitato su una sede sola e con due permessi (`venue_access`).
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
   *
   * ⚠️ **Non è più `session.user.id`.** Per un collaboratore è l'id del titolare
   * che l'ha invitato: l'organico, le ore e i documenti sono dell'azienda, non
   * di chi li sta guardando. Chi ha bisogno di "chi sono io" usa `useAuth()`.
   */
  ownerId: string | undefined;
  /** Le sedi aperte, la più vecchia prima. Vuota per chi non è un gestore. */
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
  /**
   * Il titolare dell'azienda, non un collaboratore.
   *
   * È il permesso che non si delega: aprire e chiudere sedi, invitare altri
   * collaboratori, il piano, l'eliminazione dell'account.
   */
  isOwner: boolean;
  /**
   * Ha almeno un accesso delegato attivo.
   *
   * Per un gestore è la differenza fra «titolare» e «collaboratore». Per un
   * professionista è l'interruttore della **doppia vista** (F3): se è vero, è
   * stato promosso dall'organico e può passare alla gestione.
   */
  hasVenueAccess: boolean;
  /**
   * Cosa si può fare su una sede.
   *
   * ⚠️ **È una comodità per la UI, non una difesa.** Chi decide davvero è la RLS
   * (`my_venue_ids()` in 20260916120000): nascondere un bottone senza la policy
   * corrispondente lascia la porta aperta a una chiamata REST confezionata a
   * mano — la anon key sta nel client.
   */
  can: (venueId: string, perm: TeamPermission) => boolean;
  /** C'è almeno una sede con quel permesso: serve a mostrare o no una sezione. */
  canAny: (perm: TeamPermission) => boolean;
  /** Le sedi su cui si ha quel permesso: per i picker di sede dei form. */
  venuesWith: (perm: TeamPermission) => Venue[];
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
  // Solo i gestori hanno sedi. `false` spegne la query, che è come `useMyVenue`
  // faceva con l'ownerId vuoto — qui però lo sa il provider, non ogni chiamante.
  const isManager = profile?.role === "manager";
  const myId = session?.user.id ?? "";

  /**
   * Gli accessi delegati si chiedono a **chiunque** sia loggato, non ai soli
   * gestori.
   *
   * Dal 16/09/2026 (F3) un membro dell'organico può essere promosso a gestire la
   * sede senza che il suo `profiles.role` cambi: resta `waiter`. Non c'è altro
   * modo di sapere che ha un secondo cappello se non guardando qui, e guardare
   * costa una select su `venue_access` indicizzata per `user_id` — che per un
   * professionista normale torna zero righe.
   */
  const accessQuery = useMyVenueAccess(myId);
  const access = useMemo(() => accessQuery.data ?? [], [accessQuery.data]);
  const hasVenueAccess = access.length > 0;

  // Le sedi solo a chi ne può avere: il titolare, o chi è stato delegato. Per
  // tutti gli altri la query resta spenta, come faceva `useMyVenue` con
  // l'ownerId vuoto.
  //
  // Gli id delegati si passano alla query: `getMyVenues` li usa come seconda
  // serratura accanto alla RLS (vedi il commento lì — il 15/09 una policy di
  // troppo su `venues` rendeva quella select un elenco di tutti i locali).
  const accessVenueIds = useMemo(
    () => access.map((row) => row.venue_id),
    [access]
  );
  // ⚠️ **Le sedi partono solo dopo gli accessi**, anche per un gestore.
  //
  // Gli id delegati non stanno nella query key (vedi `useMyVenues`): se le due
  // query partono insieme, le sedi si chiedono con `accessVenueIds = []` —
  // cioè «solo quelle di cui sono proprietario» — e quando gli accessi
  // arrivano la chiave è la stessa, quindi nessuno rifà la richiesta. Un
  // collaboratore con account `manager` (quelli nati da `accept-invite`)
  // restava con zero sedi, e senza sedi `ownerId` ricadeva su di lui: la
  // dashboard lo trattava da titolare di un'azienda vuota.
  //
  // Sull'app non si vedeva per caso: il provider è montato alla radice, la
  // sessione arriva prima del profilo e gli accessi partivano prima che
  // `isManager` diventasse vero. Sul web il provider si monta **dopo** il
  // profilo, e le due query partivano nello stesso render.
  const query = useMyVenues(
    !!myId && !accessQuery.isPending && (isManager || hasVenueAccess),
    myId,
    accessVenueIds
  );

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

  // I permessi per sede, indicizzati. Il titolare non compare qui: per lui la
  // risposta è sempre sì e non passa dalla mappa.
  const accessByVenue = useMemo(() => {
    const map = new Map<string, (typeof access)[number]>();
    for (const row of access) map.set(row.venue_id, row);
    return map;
  }, [access]);

  // L'azienda: per il titolare è lui stesso, per un collaboratore è chi l'ha
  // invitato. `venues[0]` basta perché le due strade non si mescolano mai — il
  // DB rifiuta sia il delegato di due aziende sia il delegato che apre una sede
  // propria (`venue_access_one_company`, `venues_owner_not_delegate`).
  const ownerId = venues[0]?.owner_id ?? (isManager ? myId : undefined);
  const isOwner = !!ownerId && ownerId === myId;

  const can = useCallback(
    (venueId: string, perm: TeamPermission) => {
      if (isOwner) return true;
      return accessByVenue.get(venueId)?.[perm] ?? false;
    },
    [isOwner, accessByVenue]
  );

  // Le due `refetch` estratte e richiuse qui: dentro il `useMemo` sotto
  // userebbero `query`/`accessQuery` interi, e la regola delle dipendenze
  // vorrebbe gli oggetti — che cambiano a ogni render di React Query.
  const refetchVenues = query.refetch;
  const refetchAccess = accessQuery.refetch;
  const refetch = useCallback(
    () => Promise.all([refetchVenues(), refetchAccess()]),
    [refetchVenues, refetchAccess]
  );

  const value = useMemo<OwnerVenuesState>(() => {
    const venueIds = venues.map((v) => v.id);
    const venuesWith = (perm: TeamPermission) =>
      isOwner ? venues : venues.filter((v) => can(v.id, perm));
    return {
      ownerId: ownerId || undefined,
      venues,
      venueIds,
      venuesKey: venuesKeyOf(venueIds),
      venueById,
      isMultiVenue: venues.length > 1,
      isOwner,
      hasVenueAccess,
      can,
      canAny: (perm) => isOwner || venues.some((v) => can(v.id, perm)),
      venuesWith,
      // Finché non si sa **anche** cosa si può fare, la UI non è pronta: senza
      // gli accessi un collaboratore vedrebbe per un istante ogni sezione
      // nascosta, e poi sparire.
      //
      // Gli accessi si aspettano sempre: è da loro che si scopre se un
      // professionista ha un secondo cappello, e quindi se le sedi vanno
      // chieste. Le sedi solo quando la loro query è davvero accesa.
      isPending:
        accessQuery.isPending ||
        ((isManager || hasVenueAccess) && query.isPending),
      isLoading:
        accessQuery.isPending ||
        ((isManager || hasVenueAccess) && query.isPending),
      isError: query.isError || accessQuery.isError,
      error: query.error ?? accessQuery.error,
      refetch,
    };
  }, [
    isManager,
    ownerId,
    isOwner,
    hasVenueAccess,
    venues,
    venueById,
    can,
    query.isPending,
    query.isError,
    query.error,
    accessQuery.isPending,
    accessQuery.isError,
    accessQuery.error,
    refetch,
  ]);

  return (
    <OwnerVenuesContext.Provider value={value}>
      {children}
    </OwnerVenuesContext.Provider>
  );
}
