import { useCallback, useEffect, useState } from "react";
import { useOwnerVenues } from "./OwnerVenues";
// ⚠️ Percorso **assoluto**, non `./lastVenueStorage`: l'alias di Vite che sul web
// sostituisce questo modulo (`web/vite.config.mts`) è registrato sulla forma
// `@/features/venues/lastVenueStorage`, e un import relativo gli sfugge — il
// build web finirebbe per tirarsi dentro `expo-secure-store`, e con lui tutto
// React Native, fallendo con «Flow is not supported».
import { loadLastVenueId, saveLastVenueId } from "@/features/venues/lastVenueStorage";

/**
 * La sede da proporre **in un form**.
 *
 * Non è uno stato globale, ed è la differenza che tiene in piedi tutto il
 * refactor del 14/09/2026: ogni form che ne ha bisogno chiama questo hook e ha
 * la sua scelta. Cambiare sede nel form turno non cambia cosa vede l'agenda, non
 * cambia l'organico, non cambia niente fuori da quel form. Se un giorno questo
 * valore risalisse in un provider sarebbe di nuovo la sede attiva, con un altro
 * nome.
 *
 * `venueId` è `undefined` finché la preferenza non è letta dal disco **e** le
 * sedi non sono arrivate: in quella finestra i form non devono partire su una
 * sede a caso, che è il modo in cui si vedrebbe lampeggiare l'organico di Roma
 * aprendo un turno di Milano.
 *
 * Nessun import di Expo o di React Native: lo storage passa da un alias (vedi
 * `lastVenueStorage.ts`), così la dashboard web riusa questo file verbatim.
 */
export type LastVenue = {
  /** `undefined` finché sedi e preferenza non sono entrambe risolte. */
  venueId: string | undefined;
  /** `true` quando `venueId` è una risposta e non un "non lo so ancora". */
  ready: boolean;
  /** Sceglie una sede e la ricorda per il prossimo form. */
  choose: (venueId: string) => void;
};

export function useLastVenue(): LastVenue {
  const { workspaceId, venues, isPending } = useOwnerVenues();
  const owner = workspaceId ?? "";

  // La preferenza letta dal disco, **insieme all'account a cui appartiene**.
  // Tenerli appaiati permette di derivare `savedId` invece di azzerarlo in un
  // effect quando si cambia account: un `setState` sincrono nel corpo di un
  // effect è un giro di render in più, e il lint di React lo vieta.
  const [saved, setSaved] = useState<{
    workspaceId: string;
    id: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadLastVenueId(owner).then((id) => {
      if (alive) setSaved({ workspaceId: owner, id });
    });
    return () => {
      alive = false;
    };
  }, [owner]);

  // `undefined` = non ancora letta *per questo account*. Distinguerlo da `null`
  // (letta, non c'era) è ciò che evita di proporre una sede prima di sapere
  // quale l'utente aveva usato l'ultima volta.
  const savedId = saved?.workspaceId === owner ? saved.id : undefined;
  const resolving = savedId === undefined || isPending;

  // La sede persistita può non esistere più: chiusa, cancellata, o di un altro
  // account. Si cade sulla più vecchia, che è anche il default di chi apre un
  // form la prima volta.
  const venueId = resolving
    ? undefined
    : (venues.find((v) => v.id === savedId)?.id ?? venues[0]?.id);

  const choose = useCallback(
    (id: string) => {
      setSaved({ workspaceId: owner, id });
      void saveLastVenueId(owner, id);
    },
    [owner]
  );

  return { venueId, ready: !resolving, choose };
}
