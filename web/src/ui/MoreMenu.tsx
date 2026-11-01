import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type MoreMenuItem = {
  label: string;
  onSelect: () => void;
  /** Spiegazione al passaggio del mouse (es. «Duplica la settimana»). */
  title?: string;
};

/**
 * Il «⋯» delle azioni secondarie: quelle che servono ogni tanto (Duplica,
 * Stampa) e che in fila con le altre facevano una barra di nove pulsanti dove
 * l'occhio non trovava il principale. Si chiude con Esc, con un clic fuori e
 * dopo una scelta.
 */
export function MoreMenu({
  items,
  label = "Altre azioni",
}: {
  items: MoreMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-gold inline-flex h-full items-center justify-center rounded-xl border border-border-2 bg-bg-2 px-3 py-2 text-sm font-semibold text-t1 transition hover:bg-bg-3"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          // `w-max`: un menu assoluto prende la larghezza del pulsante «⋯» che lo
          // contiene, e «Duplica la settimana» andava a capo.
          className="absolute right-0 z-30 mt-2 w-max min-w-40 overflow-hidden rounded-xl border border-border-2 bg-bg-2 py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "focus-gold block w-full whitespace-nowrap px-4 py-2 text-left text-sm text-t1 transition hover:bg-bg-3"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
