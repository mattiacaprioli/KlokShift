import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useOwnerPeople } from "./hooks";
import type { OwnerPerson } from "./api";

/**
 * «Questa persona sono io» — dal lato gestione.
 *
 * Fino al 2026-09-17 la domanda non esisteva, perché non poteva esistere: chi
 * gestiva e chi lavorava erano due insiemi disgiunti. Da quando il titolare (e
 * il collaboratore con il permesso Staff) può mettersi nel proprio organico, la
 * sua scheda compare nel picker «Chi chiami», nelle griglie del planning, nelle
 * ore e nell'elenco con cui si apre una chat — e ognuno di quei posti deve
 * saperlo, o mostra a qualcuno un bottone «Messaggio» verso sé stesso.
 *
 * Le tre nozioni di sé che c'erano prima sono tutte parziali e restano dove
 * sono: `useAuth()` dice chi sono, `useOwnerVenues().workspaceId` dice qual è
 * l'azienda (⚠️ per un collaboratore **non** è il mio id), `isOwner` dice se
 * l'azienda è mia. Quello che mancava è la scheda.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa verbatim.
 * ⚠️ `reactCompiler: true` — nessun hook condizionale, nessun early return.
 */
export type SelfStaffState = {
  /** `session.user.id`, o stringa vuota se non c'è sessione. */
  myId: string;
  /**
   * La mia persona nell'organico di questa azienda, se mi ci sono messo.
   * `undefined` per chi gestisce e non lavora, che è ancora il caso normale.
   */
  person: OwnerPerson | undefined;
  /** Scorciatoia leggibile per `!!person`: decide se un ingresso va mostrato. */
  hasCard: boolean;
  /**
   * Confronta un `waiter_id` col mio. Prende anche `null`/`undefined` perché è
   * il tipo che hanno in `staff_members` (mirror) e in `staff_people`: una
   * scheda senza account non è mai me, e il chiamante non deve ricordarselo.
   */
  isSelf: (waiterId: string | null | undefined) => boolean;
  /**
   * Posso segnare presenze e ore **sulla mia riga**?
   *
   * È la traduzione in UI di `private.is_restricted_self`: il titolare sì
   * (nessuno gliele segnerà, e non averle è il problema da cui parte tutto), un
   * collaboratore no — le sue le scrive chi ha il permesso Ore. Il database
   * decide comunque da sé; questo serve solo a non offrire un controllo che
   * congelerebbe in silenzio. Non più per sede: authority e organico sono
   * dell'azienda, non della singola sede.
   */
  canEditOwnPayroll: (venueId?: string) => boolean;
  /** L'organico non è ancora arrivato: non si sa se una scheda c'è. */
  isPending: boolean;
};

export function useSelfStaff(): SelfStaffState {
  const { session } = useAuth();
  const { workspaceId, isOwner } = useOwnerVenues();

  const myId = session?.user.id ?? "";

  // La stessa query dell'elenco organico, con la stessa chiave: la tab Staff
  // l'ha già in cache e qui non costa una richiesta in più.
  const peopleQuery = useOwnerPeople(workspaceId);

  const person = useMemo(
    () => (peopleQuery.data ?? []).find((p) => p.waiter_id === myId),
    [peopleQuery.data, myId]
  );

  const isSelf = useCallback(
    // ⚠️ `!!waiterId` prima del confronto: senza sessione `myId` è "" e una
    // scheda senza account ha `waiter_id` null — in JS `null === ""` è falso,
    // ma il giorno che uno dei due diventasse "" si direbbe «sei tu» a tutti.
    (waiterId: string | null | undefined) =>
      !!myId && !!waiterId && waiterId === myId,
    [myId]
  );

  // Non più per sede: `venues` non ha un `owner_id`, e la regola
  // (`private.is_restricted_self`) guarda l'azienda, non la singola sede.
  const canEditOwnPayroll = useCallback(() => isOwner, [isOwner]);

  return {
    myId,
    person,
    hasCard: !!person,
    isSelf,
    canEditOwnPayroll,
    // Senza azienda la query è spenta, e React Query tiene `isPending` vero
    // finché resta `enabled: false`: senza questa guardia chi non gestisce
    // niente resterebbe per sempre «in attesa».
    isPending: !!workspaceId && peopleQuery.isPending,
  };
}
