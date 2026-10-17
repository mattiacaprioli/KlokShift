import { useState } from "react";
import type { Venue } from "@/features/venues/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useSetVenueClosed } from "@/features/venues/hooks";
import { userErrorMessage } from "@/lib/errors";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

/**
 * «Chiudi questa sede», in fondo alla scheda. Gemella del pulsante in
 * `src/app/(manager)/venue/[id].tsx`, con lo stesso testo di conferma.
 *
 * Solo per il titolare: `set_venue_closed` accetta solo lui
 * (`private.owns_workspace`), quindi a un collaboratore il pulsante
 * prometterebbe un'azione che finisce in errore.
 *
 * "Chiudere" e non "eliminare": cancellare la riga cascaterebbe su turni,
 * organico e ore già lavorate. Si riapre da «Sedi chiuse» (`VenuesCard`).
 */
export function CloseVenueSection({
  venue,
  onClosed,
}: {
  venue: Venue;
  onClosed?: () => void;
}) {
  const { workspaceId, isOwner } = useOwnerVenues();
  const close = useSetVenueClosed(workspaceId ?? "");
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  if (!isOwner) return null;

  function doClose() {
    close.mutate(
      { venueId: venue.id, closed: true },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.show(`${venue.name} chiusa`);
          onClosed?.();
        },
        onError: (error) => {
          setConfirming(false);
          toast.show(userErrorMessage(error), "error");
        },
      }
    );
  }

  return (
    <>
      <div className="mt-10 flex max-w-4xl flex-wrap items-center justify-between gap-4 border-t border-border-2 pt-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-t2">Chiudi questa sede</p>
          <p className="mt-1 text-xs leading-5 text-t4">
            Non potrai più programmarci turni. Storico e ore restano
            consultabili e puoi riaprirla quando vuoi.
          </p>
        </div>
        <button
          type="button"
          disabled={close.isPending}
          onClick={() => setConfirming(true)}
          className="focus-gold rounded-xl border border-error/40 px-4 py-2 text-sm font-semibold text-error transition hover:bg-error/10 disabled:opacity-40"
        >
          {close.isPending ? "Chiusura…" : "Chiudi sede"}
        </button>
      </div>
      {confirming ? (
        <ConfirmDialog
          title={`Chiudere ${venue.name}?`}
          message="Sparisce dalla programmazione e non potrai più crearci turni. Lo storico di turni e ore resta consultabile, e puoi riaprirla quando vuoi da «Sedi chiuse»."
          confirmLabel="Chiudi sede"
          destructive
          pending={close.isPending}
          onConfirm={doClose}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
