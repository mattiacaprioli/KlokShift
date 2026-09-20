import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PropsWithChildren,
} from "react";

/**
 * Trascinamento dei turni nel planning, con il drag & drop **nativo** del
 * browser: nessuna libreria. Il browser regala l'autoscroll (serve: la vista
 * per persona scorre in orizzontale e il mese è più alto dello schermo),
 * l'immagine trascinata, e soprattutto non emette il `click` dopo un
 * trascinamento riuscito — che qui conta, perché ogni sorgente è già un
 * `<button>` che apre il pannello.
 *
 * Quello che il drag nativo non fa è il touch. Sta bene: questa è
 * un'interfaccia da scrivania, e **il trascinamento resta solo una
 * scorciatoia** — data e persona si cambiano comunque dal pannello del turno,
 * quindi nessuna operazione diventa raggiungibile solo trascinando.
 *
 * ## La regola, una sola per tutte e tre le viste (20/09/2026)
 *
 * **Un turno si sposta nel tempo; una persona si sposta da un turno a un
 * altro.** Settimana e mese trascinano la card del turno, quindi fanno la
 * prima cosa. La vista per persona trascina il chip di *una persona su un
 * turno*, quindi fa la seconda: in verticale cambia la persona e resta il
 * giorno, in orizzontale resta la persona e cambia il turno. In diagonale non
 * fa niente, perché sarebbero due cose insieme — e lo **dice**, invece di
 * restare spenta: è a questo che serve `rejects`.
 */

export type ShiftDragPayload =
  | {
      mode: "move";
      shiftId: string;
      title: string;
      sourceDate: string;
    }
  | {
      /**
       * Una persona su un turno. Lo stesso carico si legge in due modi a
       * seconda di dove cade: altra riga = cambia persona, altro giorno =
       * cambia turno.
       */
      mode: "person";
      shiftId: string;
      title: string;
      date: string;
      assignmentId: string;
      /** La persona (`staff_people.id`): la riga da cui parte il chip. */
      personId: string;
      fromStaffMemberId: string;
      fromStaffName: string;
      /**
       * La sede del turno. Chi lo riceve deve avere un'appartenenza **lì**:
       * `reassign` vuole un `venue_members.id`, e nessuna FK garantisce che sia
       * della stessa sede del turno.
       */
      venueId: string;
      /**
       * Le sedi in cui **questa persona** è in organico. Servono al ramo «altro
       * giorno»: il turno d'arrivo dev'essere di una di queste, altrimenti la
       * RPC risponde `not_in_roster` e la finestra avrebbe offerto una scelta
       * impossibile.
       */
      personVenueIds: string[];
      /** Chi è già sul turno: `unique (shift_id, venue_member_id)`. */
      busyStaffIds: string[];
    };

export type MoveDragPayload = Extract<ShiftDragPayload, { mode: "move" }>;
export type PersonDragPayload = Extract<ShiftDragPayload, { mode: "person" }>;

/**
 * Chi riceve un turno riassegnato: l'**appartenenza** nella sede del turno, più
 * i dati che servono alla patch ottimistica e al messaggio di conferma.
 *
 * Un tipo minimo e non `StaffMemberWithWaiter`: da quando la vista per persona
 * elenca le persone dell'azienda, la scheda di sede va risolta a partire dalla
 * persona **e** dalla sede del turno, e comporre un finto `staff_members`
 * completo per il solo gusto di rispettare un tipo più largo è il modo in cui si
 * finisce a scrivere un cast.
 */
export type ReassignTarget = {
  /** `venue_members.id` nella sede del turno. */
  id: string;
  person_id: string;
  display_name: string;
  waiter_id: string | null;
  /** Le sue mansioni **in quella sede**: servono a indovinare il ruolo. */
  roles: { id: string; name: string }[];
};

export type DropState =
  | "idle"
  /** Può ricevere il carico in volo: si offre. */
  | "candidate"
  /** Il cursore è qui e va bene. */
  | "over"
  /** Il cursore è qui e non va bene: si spiega, forte. */
  | "invalid"
  /**
   * Non può riceverlo, e si vede da lontano senza passarci sopra. Tono
   * sommesso e non l'errore pieno: in una griglia mensile i giorni passati sono
   * metà delle celle, e mezza pagina rossa non è un avviso, è un allarme.
   */
  | "blocked";

type DropSpec = {
  /** Identità stabile della cella, per sapere chi è sotto il cursore. */
  key: string;
  /** «Questo carico mi riguarda e posso prenderlo.» */
  accepts: (payload: ShiftDragPayload) => boolean;
  /**
   * «Mi riguarda, ma non posso — ed ecco perché.» Il motivo accende la cella di
   * rosso **subito**, senza aspettare il passaggio del cursore, e finisce nel
   * suo `title`. Una cella che non c'entra niente non ritorna nulla e resta
   * spenta: il rosso è un'informazione, e ovunque non è informazione.
   */
  rejects?: (payload: ShiftDragPayload) => string | null;
  onDrop: (payload: ShiftDragPayload) => void;
};

type DropHandlers = {
  state: DropState;
  /** Perché la cella rifiuta, quando `state` è "invalid" per un motivo detto. */
  reason: string | null;
  onDragEnter: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

type ShiftDragApi = {
  drag: ShiftDragPayload | null;
  /** L'elemento indicato è quello in volo? (per sbiadire la sorgente) */
  isSource: (shiftId: string, assignmentId?: string) => boolean;
  dragProps: (payload: ShiftDragPayload, label: string) => object;
  dropProps: (spec: DropSpec) => DropHandlers;
  /** Vero subito dopo un trascinamento: il click che segue va ignorato. */
  swallowClick: () => boolean;
};

const ShiftDragContext = createContext<ShiftDragApi | null>(null);

export function useShiftDrag(): ShiftDragApi {
  const ctx = useContext(ShiftDragContext);
  if (!ctx) throw new Error("useShiftDrag richiede <ShiftDragProvider />");
  return ctx;
}

/** Classi del bersaglio, uguali in tutte e tre le viste. */
export function dropClass(state: DropState): string {
  switch (state) {
    case "over":
      return "border-border-gold bg-gold/10 ring-1 ring-gold/40";
    case "invalid":
      return "border-error/40 bg-error/10 cursor-no-drop";
    case "blocked":
      return "opacity-40 cursor-no-drop";
    case "candidate":
      return "border-dashed border-border-gold/60";
    default:
      return "";
  }
}

export function ShiftDragProvider({ children }: PropsWithChildren) {
  const [drag, setDrag] = useState<ShiftDragPayload | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const suppressUntil = useRef(0);

  const dragProps = useCallback(
    (payload: ShiftDragPayload, label: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        // Obbligatorio: Firefox non avvia il trascinamento di un <button>
        // senza un contenuto dichiarato. Il carico vero sta nello stato React,
        // perché durante `dragover` il browser non lascia leggere dataTransfer.
        e.dataTransfer.setData("text/plain", label);
        // Lo stato parte *dopo* lo scatto dell'immagine trascinata: altrimenti
        // il browser fotografa la card già sbiadita e si trascina un fantasma.
        setTimeout(() => setDrag(payload), 0);
      },
      onDragEnd: () => {
        setDrag(null);
        setOverKey(null);
        // Un trascinamento annullato (ESC, rilascio fuori bersaglio) può ancora
        // far arrivare un click sulla sorgente: aprirebbe il pannello a
        // sorpresa.
        suppressUntil.current = Date.now() + 250;
      },
    }),
    []
  );

  const dropProps = useCallback(
    ({ key, accepts, rejects, onDrop }: DropSpec): DropHandlers => {
      const ok = drag != null && accepts(drag);
      const reason = drag != null && !ok ? (rejects?.(drag) ?? null) : null;
      const state: DropState =
        drag == null
          ? "idle"
          : overKey === key
            ? ok
              ? "over"
              : "invalid"
            : ok
              ? "candidate"
              : // Un rifiuto motivato si vede da lontano: è l'unico modo di
                // spiegare un gesto che non funziona *prima* di provarlo. Il
                // rosso pieno resta al passaggio del cursore.
                reason
                ? "blocked"
                : "idle";

      return {
        state,
        reason,
        onDragEnter: (e) => {
          e.preventDefault();
          setOverKey((k) => (k === key ? k : key));
        },
        onDragOver: (e) => {
          // Senza questo il `drop` non viene mai emesso.
          e.preventDefault();
          e.dataTransfer.dropEffect = ok ? "move" : "none";
          // Nessun setState qui: `dragover` scatta di continuo.
        },
        onDragLeave: (e) => {
          // Passando sopra una card dentro la cella il browser emette un
          // `dragleave` sulla cella stessa: senza questo controllo
          // l'evidenziazione si spegnerebbe proprio mentre si è sul bersaglio.
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          setOverKey((k) => (k === key ? null : k));
        },
        onDrop: (e) => {
          e.preventDefault();
          setOverKey(null);
          // `drop` precede `dragend`, quindi il carico c'è ancora.
          if (drag && ok) onDrop(drag);
        },
      };
    },
    [drag, overKey]
  );

  const isSource = useCallback(
    (shiftId: string, assignmentId?: string) => {
      if (!drag) return false;
      if (drag.mode === "person") return drag.assignmentId === assignmentId;
      return drag.shiftId === shiftId;
    },
    [drag]
  );

  const swallowClick = useCallback(() => Date.now() < suppressUntil.current, []);

  const api = useMemo(
    () => ({ drag, isSource, dragProps, dropProps, swallowClick }),
    [drag, isSource, dragProps, dropProps, swallowClick]
  );

  return (
    <ShiftDragContext.Provider value={api}>{children}</ShiftDragContext.Provider>
  );
}
