import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useAuth } from "@/lib/auth";
import { useMyContext } from "@/features/workspace/hooks";
import {
  PERM_OF,
  type TeamPermission,
} from "@/features/workspace/permissions";
import {
  isManagerMembership,
  type Authority,
  type Membership,
} from "@/features/workspace/types";
import { useMyVenues } from "./hooks";
import type { Venue } from "./api";

/**
 * L'azienda con cui si sta lavorando e le sue sedi. Tutte insieme, senza una
 * "sede attiva": la sede è **un campo del turno**, non un perimetro.
 *
 * Dal 20/09/2026 non parte più da `profile.role` e da `venue_access`: parte da
 * `get_my_context()`, cioè dalle **appartenenze** dell'account. Un account può
 * averne più d'una (titolare di un'azienda, dipendente di un'altra); qui si
 * guarda quella con cui si **gestisce**, la prima per nome. Chi ha solo appartenenze
 * da dipendente non ha un'azienda da gestire: `workspaceId` è `undefined`.
 *
 * ⚠️ Nome e forma sono quelli di prima di proposito (`useOwnerVenues`, `ownerId`,
 * `can`, `venuesKey`…): 55 file li usano. `ownerId` ora è l'id **dell'azienda**
 * (`workspaceId`), non più dell'account del titolare — per un collaboratore lo
 * era già («l'azienda, non il mio id»), adesso lo è per tutti. Nel codice nuovo
 * si scrive `workspaceId`.
 *
 * ⚠️ **Aprire o chiudere una sede non deve invalidare niente a mano.** Le chiavi
 * dei turni sono scopate per `venuesKey`: cambiando l'insieme delle sedi cambia
 * la chiave, React Query va a prendere quella nuova e tiene in cache la vecchia.
 * Un `queryClient.clear()` qui dentro è la tentazione ovvia ed è un regresso.
 *
 * ⚠️ `reactCompiler: true` (`app.json`): nessun hook condizionale, nessun early
 * return prima degli hook.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa verbatim.
 */
export type OwnerVenuesState = {
  /** L'azienda che si gestisce. `undefined` per chi non gestisce niente. */
  workspaceId: string | undefined;
  /** @deprecated Alias di `workspaceId`: usare `workspaceId`. */
  ownerId: string | undefined;
  /** La mia appartenenza in quell'azienda (chi sono io «dentro» l'azienda). */
  myMemberId: string | undefined;
  authority: Authority | undefined;
  workspaceName: string | undefined;
  /** Piano dell'azienda (chi paga), non di chi guarda. */
  plan: "free" | "pro";
  /** Tutte le mie appartenenze non uscite, anche quelle da accettare. */
  memberships: Membership[];
  /** Gli inviti ricevuti e non ancora accettati. */
  pendingInvites: Membership[];
  /** Gestisco almeno un'azienda. */
  canManage: boolean;
  /** Lavoro almeno in una: sono dipendente, o sono in organico di una sede. */
  canWork: boolean;
  /** Le sedi aperte che gestisco, la più vecchia prima. */
  venues: Venue[];
  /** Gli id: è ciò che finisce in ogni `.in("venue_id", …)`. */
  venueIds: string[];
  /**
   * `venueIds` **ordinati** e uniti da una virgola: la porzione di query key che
   * cambia quando si apre o si chiude una sede. Ordinati di proposito — riaprire
   * una sede non deve produrre uno scope diverso da quello di prima.
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
   * È il permesso che non si delega: aprire e chiudere sedi, invitare
   * collaboratori, il piano, l'eliminazione dell'azienda.
   */
  isOwner: boolean;
  /**
   * Cosa si può fare su una sede.
   *
   * ⚠️ **È una comodità per la UI, non una difesa.** Chi decide davvero è il DB
   * (`private.can()` nelle RPC, `venues_where()` nelle policy): nascondere un
   * bottone senza la regola corrispondente lascia la porta aperta a una chiamata
   * REST confezionata a mano — la anon key sta nel client.
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

const NO_MEMBERSHIPS: Membership[] = [];

export function OwnerVenuesProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const myId = session?.user.id ?? "";

  const contextQuery = useMyContext(!!myId);
  const memberships = useMemo(
    () =>
      (contextQuery.data?.memberships ?? NO_MEMBERSHIPS).filter(
        (m) => m.status !== "left"
      ),
    [contextQuery.data]
  );

  // L'azienda che si gestisce: la prima per nome fra le appartenenze da
  // titolare o collaboratore attivo. Il contesto le restituisce già ordinate.
  const current = useMemo(
    () => memberships.find(isManagerMembership),
    [memberships]
  );
  const pendingInvites = useMemo(
    () => memberships.filter((m) => m.status === "invited"),
    [memberships]
  );
  const canManage = memberships.some(isManagerMembership);
  const canWork = memberships.some(
    (m) => m.status === "active" && (m.authority === "none" || m.works.length > 0)
  );

  // Le sedi aperte dell'azienda corrente, con i permessi su ciascuna.
  const managed = useMemo(
    () => (current?.venues ?? []).filter((v) => v.closed_at === null),
    [current]
  );
  const managedIds = useMemo(() => managed.map((v) => v.id), [managed]);

  // Le sedi partono solo dopo il contesto: da lì arrivano gli id. Anche lo scope
  // vuoto ha una propria chiave e restituisce `[]`; così chiudere l'ultima sede
  // non può lasciare visibile il risultato dello scope precedente.
  const venuesQuery = useMyVenues(
    !!myId && !contextQuery.isPending,
    managedIds
  );
  // Memoizzato e non `query.data ?? []` inline: quel fallback crea un array nuovo
  // a ogni render, che finirebbe nel valore del context rifacendo render a tutte
  // le schermate del gestore per niente.
  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);

  const byId = useMemo(() => {
    const map = new Map<string, Venue>();
    for (const v of venues) map.set(v.id, v);
    return map;
  }, [venues]);
  const venueById = useCallback((id: string) => byId.get(id), [byId]);

  // I permessi per sede, indicizzati. Il titolare non passa da qui.
  const permsByVenue = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const v of current?.venues ?? []) map.set(v.id, v.perms);
    return map;
  }, [current]);

  const isOwner = current?.authority === "owner";

  const can = useCallback(
    (venueId: string, perm: TeamPermission) => {
      if (isOwner) return true;
      return permsByVenue.get(venueId)?.includes(PERM_OF[perm]) ?? false;
    },
    [isOwner, permsByVenue]
  );

  const refetchVenues = venuesQuery.refetch;
  const refetchContext = contextQuery.refetch;
  const refetch = useCallback(
    () => Promise.all([refetchContext(), refetchVenues()]),
    [refetchContext, refetchVenues]
  );

  const value = useMemo<OwnerVenuesState>(() => {
    const venueIds = venues.map((v) => v.id);
    const venuesWith = (perm: TeamPermission) =>
      isOwner ? venues : venues.filter((v) => can(v.id, perm));
    // Finché non si sa chi sono e cosa posso fare, la UI non è pronta: senza il
    // contesto un collaboratore vedrebbe per un istante ogni sezione nascosta, e
    // poi sparire. Anche lo scope vuoto deve risolversi esplicitamente in `[]`.
    const pending = contextQuery.isPending || venuesQuery.isPending;
    return {
      workspaceId: current?.workspace_id,
      ownerId: current?.workspace_id,
      myMemberId: current?.member_id,
      authority: current?.authority,
      workspaceName: current?.workspace_name,
      plan: current?.plan ?? "pro",
      memberships,
      pendingInvites,
      canManage,
      canWork,
      venues,
      venueIds,
      venuesKey: venuesKeyOf(venueIds),
      venueById,
      isMultiVenue: venues.length > 1,
      isOwner,
      can,
      canAny: (perm) => isOwner || venues.some((v) => can(v.id, perm)),
      venuesWith,
      isPending: pending,
      isLoading: pending,
      isError: contextQuery.isError || venuesQuery.isError,
      error: contextQuery.error ?? venuesQuery.error,
      refetch,
    };
  }, [
    current,
    memberships,
    pendingInvites,
    canManage,
    canWork,
    venues,
    venueById,
    isOwner,
    can,
    contextQuery.isPending,
    contextQuery.isError,
    contextQuery.error,
    venuesQuery.isPending,
    venuesQuery.isError,
    venuesQuery.error,
    refetch,
  ]);

  return (
    <OwnerVenuesContext.Provider value={value}>
      {children}
    </OwnerVenuesContext.Provider>
  );
}
