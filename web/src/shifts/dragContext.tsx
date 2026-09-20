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
 */

export type ShiftDragPayload =
  | {
      mode: "move";
      shiftId: string;
      title: string;
      sourceDate: string;
    }
  | {
      mode: "reassign";
      shiftId: string;
      title: string;
      /** Il giorno non cambia: si cambia solo la persona. */
      date: string;
      assignmentId: string;
      fromStaffMemberId: string;
      fromStaffName: string;
      /**
       * La sede del turno. Chi lo riceve deve avere un'appartenenza **lì**:
       * `reassign_shift_assignment` vuole uno `staff_members.id`, e nessuna FK
       * garantisce che sia della stessa sede del turno.
       */
      venueId: string;
      /** Chi è già sul turno: `unique (shift_id, venue_member_id)`. */
      busyStaffIds: string[];
    };

export type MoveDragPayload = Extract<ShiftDragPayload, { mode: "move" }>;
export type ReassignDragPayload = Extract<
  ShiftDragPayload,
  { mode: "reassign" }
>;

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
  /** `staff_members.id` nella sede del turno. */
  id: string;
  person_id: string;
  display_name: string;
  waiter_id: string | null;
  /** Le sue mansioni **in quella sede**: servono a indovinare il ruolo. */
  roles: { id: string; name: string }[];
};

export type DropState = "idle" | "candidate" | "over" | "invalid";

type DropSpec = {
  /** Identità stabile della cella, per sapere chi è sotto il cursore. */
  key: string;
  accepts: (payload: ShiftDragPayload) => boolean;
  onDrop: (payload: ShiftDragPayload) => void;
};

type DropHandlers = {
  state: DropState;
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
    ({ key, accepts, onDrop }: DropSpec): DropHandlers => {
      const ok = drag != null && accepts(drag);
      const state: DropState =
        drag == null
          ? "idle"
          : overKey === key
            ? ok
              ? "over"
              : "invalid"
            : ok
              ? "candidate"
              : "idle";

      return {
        state,
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
      if (drag.mode === "reassign") return drag.assignmentId === assignmentId;
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
