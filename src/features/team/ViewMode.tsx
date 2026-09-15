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
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { loadViewMode, saveViewMode, type ViewMode } from "./viewModeStorage";

/**
 * Il cappello con cui un professionista promosso sta usando l'app.
 *
 * Un provider e non un hook per schermata: la vista decide **quale gruppo di
 * rotte** è montato (`src/app/_layout.tsx`), e due copie dello stesso stato
 * porterebbero il navigatore e l'interruttore a non essere d'accordo.
 *
 * ⚠️ `effective` non è quello che l'utente ha scelto: è quello che **può**
 * avere. Chi non ha accessi delegati attivi è sempre `"waiter"`, anche se la
 * preferenza sul disco dice altro — un accesso revocato non deve lasciare
 * qualcuno fermo su una dashboard vuota. Per la stessa ragione la preferenza non
 * si cancella quando la revoca arriva: se il titolare lo riabilita, lo ritrova
 * dove l'aveva lasciato.
 *
 * Per un titolare o per un collaboratore con account `manager` questo provider
 * non fa niente: `canSwitch` è falso e `effective` è `"manager"` per via del
 * ruolo, non per via di questa preferenza.
 */
type ViewModeState = {
  /** La vista attiva adesso. */
  effective: ViewMode;
  /** La doppia vista esiste per questa persona (professionista promosso). */
  canSwitch: boolean;
  /** `false` finché la preferenza non è letta dal disco. */
  ready: boolean;
  setMode: (mode: ViewMode) => void;
};

const ViewModeContext = createContext<ViewModeState | null>(null);

export function useViewMode(): ViewModeState {
  const ctx = useContext(ViewModeContext);
  if (!ctx) {
    throw new Error("useViewMode deve essere usato dentro <ViewModeProvider />");
  }
  return ctx;
}

export function ViewModeProvider({ children }: PropsWithChildren) {
  const { session, profile } = useAuth();
  const { hasVenueAccess, isPending } = useOwnerVenues();

  const userId = session?.user.id ?? "";
  const isWaiter = profile?.role === "waiter";
  const canSwitch = isWaiter && hasVenueAccess;

  // La preferenza letta dal disco, **insieme all'account a cui appartiene**:
  // derivarla invece di azzerarla in un effect evita un render in più al cambio
  // account. Stessa forma di `useLastVenue`.
  const [saved, setSaved] = useState<{
    userId: string;
    mode: ViewMode | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadViewMode(userId).then((mode) => {
      if (alive) setSaved({ userId, mode });
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const savedMode = saved?.userId === userId ? saved.mode : undefined;

  const setMode = useCallback(
    (mode: ViewMode) => {
      setSaved({ userId, mode });
      void saveViewMode(userId, mode);
    },
    [userId]
  );

  const value = useMemo<ViewModeState>(() => {
    return {
      effective: canSwitch && savedMode === "manager" ? "manager" : "waiter",
      canSwitch,
      /**
       * ⚠️ Gli accessi si aspettano **solo** se la preferenza dice "manager".
       *
       * Questo valore trattiene lo splash (`src/app/_layout.tsx`). Aspettare
       * `isPending` per tutti vorrebbe dire che ogni avvio dell'app — titolare,
       * professionista, chiunque — resta sullo splash finché una query di rete
       * non risponde. Offline è peggio che lento: React Query riprova tre volte
       * con backoff prima di dichiarare l'errore, e `isPending` resta vero per
       * tutto quel tempo.
       *
       * Chi ha scritto "manager" sul disco è l'unico per cui la risposta cambia
       * dove atterra, ed è anche l'unico che paga l'attesa. Per tutti gli altri
       * basta la lettura da disco, che è immediata.
       */
      ready: savedMode !== undefined && (savedMode !== "manager" || !isPending),
      setMode,
    };
  }, [canSwitch, savedMode, isPending, setMode]);

  return (
    <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
  );
}
