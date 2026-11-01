import { useEffect } from "react";
import { usePublishPreview, usePublishShifts } from "@/features/assignments/hooks";
import {
  PUBLISH_EMPTY,
  PUBLISH,
  PUBLISH_ERROR,
  PUBLISH_NOTIFY,
  PUBLISH_PREVIEW_ERROR,
  PUBLISH_SILENT,
  PUBLISH_TITLE,
  publishPreviewLines,
  publishedToast,
  shouldOfferNotifyChoice,
} from "@/features/shifts/drafts";
import { userErrorMessage } from "@/lib/errors";
import { Button, Spinner } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * «Pubblica» per un periodo: carica l'anteprima (cosa si pubblica e chi viene
 * avvisato) e pubblica **esattamente i turni dell'anteprima**, non quelli che nel
 * frattempo fossero comparsi. Due strade: con gli avvisi, o in silenzio.
 * Gemello di `src/features/shifts/PublishModal`.
 */
export function PublishDialog({
  venueIds,
  from,
  to,
  onClose,
}: {
  venueIds: string[];
  from: string;
  to: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const preview = usePublishPreview(venueIds, from, to, true);
  const publish = usePublishShifts();
  const data = preview.data;
  const nothing = !!data && data.shift_ids.length === 0;
  const pending = publish.isPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function submit(notify: boolean) {
    if (!data || data.shift_ids.length === 0) return;
    publish.mutate(
      { shiftIds: data.shift_ids, notify },
      {
        onSuccess: (result) => {
          toast.show(publishedToast(result.published));
          onClose();
        },
        onError: (e) => toast.show(userErrorMessage(e, PUBLISH_ERROR), "error"),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={pending ? undefined : onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={PUBLISH_TITLE}
        aria-modal
        className="relative w-full max-w-sm rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-lg text-t1">{PUBLISH_TITLE}</h2>

        {preview.isLoading ? (
          <div className="mt-4">
            <Spinner />
          </div>
        ) : preview.isError ? (
          <p className="mt-3 text-sm leading-5 text-error">
            {userErrorMessage(preview.error, PUBLISH_PREVIEW_ERROR)}
          </p>
        ) : nothing ? (
          <p className="mt-3 text-sm leading-5 text-t2">{PUBLISH_EMPTY}</p>
        ) : data ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm leading-5 text-t2">
            {publishPreviewLines(data).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {data && !nothing ? (
            <>
              {shouldOfferNotifyChoice(data) ? (
                <>
                  <Button
                    variant="gold"
                    onClick={() => submit(true)}
                    disabled={pending}
                    autoFocus
                  >
                    {pending ? "Attendere…" : PUBLISH_NOTIFY}
                  </Button>
                  <Button onClick={() => submit(false)} disabled={pending}>
                    {PUBLISH_SILENT}
                  </Button>
                </>
              ) : (
                <Button
                  variant="gold"
                  onClick={() => submit(false)}
                  disabled={pending}
                  autoFocus
                >
                  {pending ? "Attendere…" : PUBLISH}
                </Button>
              )}
            </>
          ) : null}
          <Button onClick={onClose} disabled={pending}>
            {data && !nothing ? "Annulla" : "Chiudi"}
          </Button>
        </div>
      </div>
    </div>
  );
}
