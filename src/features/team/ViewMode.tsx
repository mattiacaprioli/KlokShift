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
 * Il cappello con cui si sta usando l'app: **gestione** (`manager`) o **lavoro**
 * (`waiter`).
 *
 * Non è più scritto sul profilo (`profiles.role` non esiste): si ricava dalle
 * appartenenze. Chi gestisce e basta è in gestione, chi lavora e basta è nel
 * lavoro, e chi fa entrambe le cose — un titolare che è anche in turno, un
 * professionista promosso a collaboratore, un dipendente che possiede un'altra
 * azienda — sceglie con l'interruttore.
 *
 * Un provider e non un hook per schermata: la vista decide **quale gruppo di
 * rotte** è montato (`src/app/_layout.tsx`), e due copie dello stesso stato
 * porterebbero il navigatore e l'interruttore a non essere d'accordo.
 *
 * ⚠️ `effective` non è quello che l'utente ha scelto: è quello che **può**
 * avere. Un accesso revocato non deve lasciare qualcuno fermo su una dashboard
 * vuota, quindi a contesto caricato vince sempre il calcolo, non la preferenza.
 *
 * Chi non ha ancora nessuna appartenenza (account appena creato) va dove ha
 * detto di voler andare alla registrazione (`user_metadata.intent`): è un
 * suggerimento per la prima schermata, non un ruolo e non un permesso.
 *
 * ⚠️ Solo mobile: la dashboard web non ha un lato professionista.
 */
type ViewModeState = {
  /** La vista attiva adesso. */
  effective: ViewMode;
  /** Le due viste esistono entrambe per questa persona. */
  canSwitch: boolean;
  /** `false` finché la vista non è nota (disco, e all'occorrenza rete). */
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

/** Cosa ha detto di voler fare alla registrazione. Un'indicazione, non un ruolo. */
export function signupIntent(
  metadata: Record<string, unknown> | undefined
): ViewMode {
  return metadata?.intent === "manager" ? "manager" : "waiter";
}

export function ViewModeProvider({ children }: PropsWithChildren) {
  const { session, profile } = useAuth();
  const { canManage, canWork, isPending } = useOwnerVenues();

  const userId = session?.user.id ?? "";
  const intent = signupIntent(session?.user.user_metadata);
  const resolved = !isPending;
  /**
   * L'interruttore fra le due viste.
   *
   * Serve a chi gestisce **e** ha un lato professionista da cui tornare. Quel
   * lato esiste se lavora da qualche parte, oppure se ha completato la propria
   * scheda da professionista (`onboarding_complete`): è il caso di chi era un
   * professionista e si è aperto un posto suo, e senza questa seconda
   * condizione resterebbe chiuso nella gestione, con il proprio profilo di
   * carriera irraggiungibile.
   *
   * Chi si è registrato come sede e non ha mai fatto quell'onboarding non vede
   * l'interruttore: dall'altra parte non ha niente, e ci troverebbe solo il
   * wizard di un profilo che non gli serve.
   */
  const canSwitch =
    canManage && (canWork || !!profile?.onboarding_complete);

  // L'ultima vista, letta dal disco **insieme all'account a cui appartiene**:
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

  // A contesto caricato: il calcolo. Prima: l'ultima vista nota, o l'intento.
  const computed: ViewMode = useMemo(() => {
    if (canManage && canWork) return savedMode === "waiter" ? "waiter" : "manager";
    if (canManage) return "manager";
    if (canWork) return "waiter";
    return intent;
  }, [canManage, canWork, savedMode, intent]);
  const effective: ViewMode = resolved ? computed : (savedMode ?? intent);

  // Si ricorda l'ultima vista **risolta**, così il prossimo avvio parte subito
  // senza aspettare la rete (vedi `ready`).
  //
  // ⚠️ Scrive solo sul disco, non nello stato: `setSaved` qui dentro sarebbe un
  // `setState` in un effect (e un render in più a ogni avvio) per un valore che
  // serve alla **prossima** apertura. Finché la sessione è viva vince comunque
  // il calcolo, quindi lo stato può restare indietro.
  useEffect(() => {
    if (userId && resolved && savedMode !== undefined && savedMode !== effective) {
      void saveViewMode(userId, effective);
    }
  }, [userId, resolved, savedMode, effective]);

  const value = useMemo<ViewModeState>(
    () => ({
      effective,
      canSwitch,
      /**
       * ⚠️ La rete si aspetta **solo** al primo avvio dopo un login, quando non
       * c'è ancora una vista ricordata. Aspettare `isPending` per tutti vorrebbe
       * dire che ogni avvio dell'app resta sullo splash finché una query non
       * risponde: offline è peggio che lento (`retry: 1`, vedi
       * `lib/queryClient.ts`, sono due tentativi prima dell'errore).
       */
      ready: savedMode !== undefined && (savedMode !== null || resolved),
      setMode,
    }),
    [effective, canSwitch, savedMode, resolved, setMode]
  );

  return (
    <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
  );
}
