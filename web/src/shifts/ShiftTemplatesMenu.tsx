import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { formatShiftRange } from "@/lib/format";
import type { ShiftTemplate } from "@/features/shiftTemplates/api";
import {
  useDeleteShiftTemplate,
  useVenueShiftTemplates,
} from "@/features/shiftTemplates/hooks";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Button } from "../ui/primitives";
import { useToast } from "../ui/Toast";

const MENU_WIDTH = 288;

/**
 * «Modelli» nell'intestazione del pannello, accanto a «Chiudi»: un clic apre
 * l'elenco dei modelli della sede del form, un clic su un modello riempie il
 * form, la «×» lo elimina.
 *
 * L'elenco è quello della sede **già scelta**: applicare un modello non cambia
 * mai sede, e quindi non azzera le persone già selezionate. Il menu si ancora
 * sotto al pulsante e allineato al suo bordo destro, come quello di `Select`.
 */
export function ShiftTemplatesMenu({
  venueId,
  activeId,
  onApply,
}: {
  venueId: string | undefined;
  activeId: string | null;
  onApply: (template: ShiftTemplate) => void;
}) {
  const toast = useToast();
  const templates = useVenueShiftTemplates(venueId);
  const remove = useDeleteShiftTemplate();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ShiftTemplate | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 });
  // Il contenitore del pulsante: `Button` non inoltra un ref.
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const list = templates.data ?? [];

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 8;
    setPosition({
      left: Math.max(gutter, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - gutter)),
      top: rect.bottom + gutter,
      maxHeight: Math.max(120, window.innerHeight - rect.bottom - gutter * 2),
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
      <Button
        onClick={() => setOpen((o) => !o)}
        disabled={!venueId}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Modelli
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
          className={cn("shrink-0 text-t3 transition", open && "rotate-180")}
        >
          <path d="m3 6 5 5 5-5" />
        </svg>
      </Button>
      </span>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Modelli di turno"
              className="fixed z-50 overflow-y-auto rounded-xl border border-border-2 bg-bg-card p-1 shadow-xl"
              style={{
                left: position.left,
                top: position.top,
                width: MENU_WIDTH,
                maxHeight: position.maxHeight,
              }}
            >
              {list.length === 0 ? (
                <p className="px-3 py-3 text-xs leading-5 text-t3">
                  {templates.isPending
                    ? "Caricamento…"
                    : "Nessun modello per questa sede. Compila il turno e usa «Salva come modello»."}
                </p>
              ) : (
                list.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-1 rounded-lg hover:bg-bg-3"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onApply(t);
                        setOpen(false);
                      }}
                      className="focus-gold min-w-0 flex-1 rounded-lg px-3 py-2 text-left"
                    >
                      <span
                        className={cn(
                          "block truncate text-sm",
                          t.id === activeId ? "font-semibold text-gold" : "text-t1"
                        )}
                      >
                        {t.name}
                      </span>
                      <span className="block font-mono text-[11px] text-t4">
                        {formatShiftRange(t.start_time, t.end_time)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setToDelete(t);
                      }}
                      aria-label={`Elimina il modello ${t.name}`}
                      title="Elimina il modello"
                      className="focus-gold mr-1 rounded-lg px-2 py-1 text-t4 hover:text-error"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>,
            document.body
          )
        : null}

      {toDelete ? (
        <ConfirmDialog
          title={`Eliminare «${toDelete.name}»?`}
          message="I turni già creati da questo modello non cambiano."
          confirmLabel="Elimina modello"
          destructive
          pending={remove.isPending}
          onCancel={() => setToDelete(null)}
          onConfirm={() =>
            remove.mutate(toDelete.id, {
              onSuccess: () => {
                toast.show("Modello eliminato");
                setToDelete(null);
              },
              onError: (e) => {
                toast.show(userErrorMessage(e), "error");
                setToDelete(null);
              },
            })
          }
        />
      ) : null}
    </>
  );
}
