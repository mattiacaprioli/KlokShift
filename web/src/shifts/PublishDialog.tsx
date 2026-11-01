import { useEffect, useState } from "react";
import { usePublishPreview, usePublishShifts } from "@/features/assignments/hooks";
import {
  NOTIFY_HINT,
  PUBLISH_EMPTY,
  PUBLISH_ERROR,
  PUBLISH_PREVIEW_ERROR,
  SILENT_HINT,
  draftsCountLabel,
  nobodyToNotifyText,
  notifyLabel,
  outsideNote,
  publishCta,
  publishTitle,
  publishedToast,
} from "@/features/shifts/drafts";
import { userErrorMessage } from "@/lib/errors";
import { Button, Spinner } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * «Pubblica» per un periodo: carica l'anteprima (cosa si pubblica e chi viene
 * avvisato) e pubblica **esattamente i turni dell'anteprima**, non quelli che nel
 * frattempo fossero comparsi.
 *
 * Gli avvisi sono una spunta accesa di default, non un secondo pulsante: con
 * «Pubblica e avvisa» e «Pubblica senza avvisi» affiancati non si capiva quale
 * fosse la strada normale. Gemello di `src/features/shifts/PublishModal`.
 */
export function PublishDialog({
  venueIds,
  from,
  to,
  period,
  periodLabel,
  onClose,
}: {
  venueIds: string[];
  from: string;
  to: string;
  period: "week" | "month";
  /** «2 – 8 novembre 2026», come nell'intestazione del planning. */
  periodLabel: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const preview = usePublishPreview(venueIds, from, to, true);
  const publish = usePublishShifts();
  const [notify, setNotify] = useState(true);
  const data = preview.data;
  const ready = !!data && data.shift_ids.length > 0;
  const pending = publish.isPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function submit() {
    if (!data || data.shift_ids.length === 0) return;
    publish.mutate(
      // Senza nessuno da avvisare la spunta non c'è: si pubblica in silenzio.
      { shiftIds: data.shift_ids, notify: notify && data.people > 0 },
      {
        onSuccess: (result) => {
          toast.show(publishedToast(result.published));
          onClose();
        },
        onError: (e) => toast.show(userErrorMessage(e, PUBLISH_ERROR), "error"),
      },
    );
  }

  const title = publishTitle(period);
  const note = data ? outsideNote(data.outside) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={pending ? undefined : onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={title}
        aria-modal
        className="relative w-full max-w-md rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-xl text-t1">{title}</h2>
        <p className="mt-1 text-sm text-t3">{periodLabel}</p>

        {preview.isLoading ? (
          <div className="mt-6">
            <Spinner />
          </div>
        ) : preview.isError ? (
          <p className="mt-5 text-sm leading-5 text-error">
            {userErrorMessage(preview.error, PUBLISH_PREVIEW_ERROR)}
          </p>
        ) : !ready ? (
          <p className="mt-5 text-sm leading-5 text-t2">{PUBLISH_EMPTY}</p>
        ) : (
          <>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="font-serif text-4xl leading-none text-t1">
                {data.shifts}
              </span>
              <span className="text-sm text-t2">
                {draftsCountLabel(data.shifts)}
              </span>
            </p>

            {data.people > 0 ? (
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border-2 bg-bg-2 p-3.5 transition hover:border-border-gold">
                <input
                  type="checkbox"
                  checked={notify}
                  disabled={pending}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="mt-0.5 size-4 accent-gold"
                />
                <span>
                  <span className="block text-sm font-semibold text-t1">
                    {notifyLabel(data.people)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-t3">
                    {notify ? NOTIFY_HINT : SILENT_HINT}
                  </span>
                </span>
              </label>
            ) : (
              <p className="mt-5 rounded-xl border border-border-2 bg-bg-2 p-3.5 text-xs leading-5 text-t3">
                {nobodyToNotifyText(data)}
              </p>
            )}

            {note ? (
              <p className="mt-3 text-xs leading-5 text-t4">{note}</p>
            ) : null}
          </>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>
            {ready ? "Annulla" : "Chiudi"}
          </Button>
          {ready ? (
            <Button
              variant="gold"
              onClick={submit}
              disabled={pending}
              autoFocus
            >
              {pending ? "Attendere…" : publishCta(data.shifts)}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
