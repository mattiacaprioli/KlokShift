import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export type MessageAction = {
  label: string;
  icon: "edit" | "delete";
  onSelect: () => void;
  danger?: boolean;
};

type Anchor = { x: number; y: number; top: number; bottom: number };

const GAP = 6;
const MARGIN = 8;

/**
 * Le azioni su un messaggio (Modifica, Elimina), come WhatsApp Web e Slack: una
 * freccetta discreta al passaggio del mouse, o il clic destro sulla bolla.
 *
 * Il menu non vive dentro la lista che scorre: sta in un portale a posizione
 * fissa, sotto il punto d'apertura se c'è spazio, altrimenti sopra. Così
 * sull'ultimo messaggio non finisce più nascosto sotto il campo di scrittura.
 */
export function useMessageMenu(actions: MessageAction[], own: boolean) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const enabled = actions.length > 0;

  const openAt = (a: Anchor) => {
    if (enabled) setAnchor(a);
  };

  const trigger = enabled ? (
    <button
      type="button"
      aria-label="Azioni sul messaggio"
      title="Azioni sul messaggio"
      aria-haspopup="menu"
      aria-expanded={anchor != null}
      onClick={(e) => {
        if (anchor) return setAnchor(null);
        const r = e.currentTarget.getBoundingClientRect();
        openAt({
          x: own ? r.right : r.left,
          y: r.bottom,
          top: r.top,
          bottom: r.bottom,
        });
      }}
      className={cn(
        "focus-gold flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-t3 transition hover:bg-bg-3 hover:text-t1",
        anchor ? "bg-bg-3 text-t1 opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
        <path
          d="M5.5 7.5 10 12l4.5-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  ) : null;

  const onContextMenu = enabled
    ? (e: MouseEvent) => {
        e.preventDefault();
        openAt({ x: e.clientX, y: e.clientY, top: e.clientY, bottom: e.clientY });
      }
    : undefined;

  const menu =
    anchor != null ? (
      <MenuPopover
        anchor={anchor}
        alignRight={own}
        actions={actions}
        onClose={() => setAnchor(null)}
      />
    ) : null;

  return { trigger, menu, onContextMenu, open: anchor != null };
}

function MenuPopover({
  anchor,
  alignRight,
  actions,
  onClose,
}: {
  anchor: Anchor;
  alignRight: boolean;
  actions: MessageAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Si misura prima di mostrarlo: sotto se ci sta, altrimenti sopra; mai fuori
  // dalla finestra.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = anchor.bottom + GAP;
    const top =
      below + height + MARGIN <= vh
        ? below
        : Math.max(MARGIN, anchor.top - GAP - height);
    const rawLeft = alignRight ? anchor.x - width : anchor.x;
    const left = Math.min(Math.max(MARGIN, rawLeft), vw - width - MARGIN);
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [anchor, alignRight]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Il menu è fisso: se la lista scorre o la finestra cambia, si chiude
    // invece di restare appeso nel vuoto.
    function onMove() {
      onClose();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 min-w-44 rounded-xl border border-border-2 bg-bg-card p-1 shadow-lg"
    >
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            a.onSelect();
          }}
          className={cn(
            "focus-gold flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition",
            a.danger ? "text-error hover:bg-error/10" : "text-t1 hover:bg-bg-3"
          )}
        >
          <ActionIcon name={a.icon} />
          {a.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

function ActionIcon({ name }: { name: MessageAction["icon"] }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 opacity-80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {name === "edit" ? (
        <path d="M12.5 4.5l3 3L8 15H5v-3l7.5-7.5z" />
      ) : (
        <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4" />
      )}
    </svg>
  );
}
