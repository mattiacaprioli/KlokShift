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
 * sono: `useAuth()` dice chi sono, `useOwnerVenues().ownerId` dice qual è
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
   * Posso segnare presenze e ore **sulla mia riga** dei turni di questa sede?
   *
   * È la traduzione in UI della regola di `20260919100000`: il titolare sì
   * (nessuno gliele segnerà, e non averle è il problema da cui parte tutto), un
   * collaboratore no — le sue le scrive chi ha il permesso Ore. Il database
   * decide comunque da sé (`private.my_delegate_staff_member_ids`); questo
   * serve solo a non offrire un controllo che congelerebbe in silenzio.
   *
   * Per sede e non globale, come la regola in SQL, che guarda
   * `venues.owner_id` della sede del turno.
   */
  canEditOwnPayroll: (venueId: string) => boolean;
  /** L'organico non è ancora arrivato: non si sa se una scheda c'è. */
  isPending: boolean;
};

export function useSelfStaff(): SelfStaffState {
  const { session } = useAuth();
  const { ownerId, isOwner, venueById } = useOwnerVenues();

  const myId = session?.user.id ?? "";

  // La stessa query dell'elenco organico, con la stessa chiave: la tab Staff
  // l'ha già in cache e qui non costa una richiesta in più.
  const peopleQuery = useOwnerPeople(ownerId);

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

  const canEditOwnPayroll = useCallback(
    (venueId: string) => {
      const venue = venueById(venueId);
      // Sede non in elenco (appena chiusa, cache vecchia): si ricade su
      // «l'azienda è mia», che è la stessa risposta in ogni caso reale — il DB
      // vieta a un collaboratore di possedere sedi e di servire due aziende.
      return venue ? venue.owner_id === myId : isOwner;
    },
    [venueById, myId, isOwner]
  );

  return {
    myId,
    person,
    hasCard: !!person,
    isSelf,
    canEditOwnPayroll,
    // Senza azienda la query è spenta, e React Query tiene `isPending` vero
    // finché resta `enabled: false`: senza questa guardia chi non gestisce
    // niente resterebbe per sempre «in attesa».
    isPending: !!ownerId && peopleQuery.isPending,
  };
}
