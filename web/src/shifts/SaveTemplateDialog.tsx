import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { userErrorMessage } from "@/lib/errors";
import {
  useSaveShiftTemplate,
  useVenueShiftTemplates,
} from "@/features/shiftTemplates/hooks";
import {
  MAX_TEMPLATE_NAME,
  findTemplateByName,
  type ShiftTemplateInput,
} from "@/features/shiftTemplates/template";
import { Button, Field, Input } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * Dà un nome al modello e lo salva (equivalente web di `SaveTemplateModal`).
 * Si monta solo quando serve, così il nome riparte da quello proposto.
 *
 * ⚠️ In un portale, e con `stopPropagation` sul submit: nasce dentro il form del
 * turno, e lì Invio nel campo nome avrebbe creato il turno. Il DOM lo risolve il
 * portale; l'evento React risale comunque l'albero dei componenti, ed è per
 * questo che serve anche lo stop.
 */
export function SaveTemplateDialog({
  venueId,
  template,
  onSaved,
  onClose,
}: {
  venueId: string;
  /** Il turno da ricordare; `name` è il nome proposto. */
  template: ShiftTemplateInput;
  onSaved?: (saved: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const templates = useVenueShiftTemplates(venueId);
  const save = useSaveShiftTemplate();
  const existing = findTemplateByName(templates.data ?? [], name);
  const pending = save.isPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    save.mutate(
      { venueId, input: { ...template, name: trimmed } },
      {
        onSuccess: (id) => {
          toast.show(existing ? "Modello aggiornato" : "Modello salvato");
          onSaved?.({ id, name: trimmed });
          onClose();
        },
      }
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={pending ? undefined : onClose}
        aria-hidden
      />
      <form
        role="dialog"
        aria-modal
        aria-label="Salva come modello"
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-lg text-t1">Salva come modello</h2>
        <p className="mt-2 text-sm leading-5 text-t2">
          Ricorda orari, pausa, persone che servono e note. Giorno e persone li scegli
          ogni volta.
        </p>

        <div className="mt-5">
          <Field
            label="Nome del modello"
            hint={
              existing
                ? `Esiste già «${existing.name}»: salvando lo aggiorni.`
                : undefined
            }
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Es. Cena"
              maxLength={MAX_TEMPLATE_NAME}
              autoFocus
            />
          </Field>
        </div>

        {save.error ? (
          <p className="mt-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            {userErrorMessage(save.error, "Modello non salvato. Riprova.")}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="gold"
            disabled={pending || !name.trim()}
          >
            {pending ? "Salvataggio…" : "Salva modello"}
          </Button>
          <Button onClick={onClose} disabled={pending}>
            Annulla
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
