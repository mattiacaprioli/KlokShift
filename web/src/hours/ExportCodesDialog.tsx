import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { userErrorMessage } from "@/lib/errors";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { operationsGate } from "@/features/workspace/access";
import { useExportCodes, useSaveExportCodes } from "@/features/assignments/hooks";
import {
  EXPORT_CODE_KEYS,
  EXPORT_CODE_LABELS,
  type ExportCodeKey,
  type ExportCodes,
} from "@/features/assignments/exportCodes";
import { Button, Field, Input } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * I codici del programma paghe del consulente: il codice dell'azienda e uno per
 * causale (equivalente web di `(manager)/codici-consulente`). Finiscono nei CSV
 * della pagina Ore; vuoti = colonna vuota, l'export parte lo stesso.
 */
export function ExportCodesDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const query = useExportCodes(workspaceId);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Codici per il consulente"
        className="relative w-full max-w-md rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-lg text-t1">Codici per il consulente</h2>
        <p className="mt-2 text-sm leading-5 text-t2">
          Te li dà il tuo consulente: sono i codici del suo programma paghe. Puoi
          lasciarli vuoti.
        </p>
        {query.isPending ? (
          <p className="mt-5 text-sm text-t3">Caricamento…</p>
        ) : query.isError ? (
          <p className="mt-5 text-sm text-error">{userErrorMessage(query.error)}</p>
        ) : (
          <CodesForm workspaceId={workspaceId} initial={query.data} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body
  );
}

function CodesForm({
  workspaceId,
  initial,
  onClose,
}: {
  workspaceId: string;
  initial: ExportCodes;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveExportCodes(workspaceId);
  const pending = save.isPending;
  // In archivio i codici si leggono ma non si cambiano: lo si dice, invece di
  // lasciar fallire «Salva».
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const [values, setValues] = useState<Record<ExportCodeKey, string>>(() => {
    const out = {} as Record<ExportCodeKey, string>;
    for (const k of EXPORT_CODE_KEYS) out[k] = initial.codes[k] ?? "";
    return out;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || !gate.allowed) return;
    save.mutate(values, {
      onSuccess: () => {
        toast.show("Codici salvati");
        onClose();
      },
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {EXPORT_CODE_KEYS.map((k) => (
          <Field key={k} label={EXPORT_CODE_LABELS[k]}>
            <Input
              value={values[k]}
              maxLength={20}
              disabled={!gate.allowed}
              autoComplete="off"
              onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {save.error ? (
        <p className="mt-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          {userErrorMessage(save.error)}
        </p>
      ) : null}
      {gate.allowed ? null : (
        <p className="mt-4 text-sm text-t3">{gate.reason}</p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {gate.allowed ? (
          <Button type="submit" variant="gold" disabled={pending}>
            {pending ? "Salvataggio…" : "Salva"}
          </Button>
        ) : null}
        <Button onClick={onClose} disabled={pending}>
          {gate.allowed ? "Annulla" : "Chiudi"}
        </Button>
      </div>
    </form>
  );
}
