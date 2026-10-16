import { useState } from "react";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import type { ShiftTemplate } from "@/features/shiftTemplates/api";
import {
  useDeleteShiftTemplate,
  useVenueShiftTemplates,
} from "@/features/shiftTemplates/hooks";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

/**
 * I modelli della sede del form, da cui ripartire con un clic; la «×» ne
 * elimina uno. Senza modelli non rende niente: si creano da «Salva come
 * modello», in fondo al pannello.
 *
 * La lista è quella della sede **già scelta**: applicare un modello non cambia
 * mai sede, e quindi non azzera le persone già selezionate.
 */
export function ShiftTemplatesRow({
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
  const [toDelete, setToDelete] = useState<ShiftTemplate | null>(null);
  const list = templates.data ?? [];
  if (list.length === 0) return null;

  return (
    <section>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
        Parti da un modello
      </span>
      <div className="flex flex-wrap gap-2">
        {list.map((t) => {
          const active = t.id === activeId;
          return (
            <span
              key={t.id}
              className={cn(
                "inline-flex items-center rounded-full border text-xs transition",
                active
                  ? "border-border-gold bg-gold/10 text-t1"
                  : "border-border-2 text-t2"
              )}
            >
              <button
                type="button"
                onClick={() => onApply(t)}
                className="focus-gold rounded-l-full py-1 pl-3 pr-1.5 hover:text-t1"
              >
                {t.name}
              </button>
              <button
                type="button"
                onClick={() => setToDelete(t)}
                aria-label={`Elimina il modello ${t.name}`}
                title="Elimina il modello"
                className="focus-gold rounded-r-full py-1 pl-1 pr-2.5 text-t4 hover:text-error"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

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
    </section>
  );
}
