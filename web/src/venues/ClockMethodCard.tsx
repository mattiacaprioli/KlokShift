import type { Venue } from "@/features/venues/api";
import { useSetVenueClockAutoApprove, useSetVenueClockMethod } from "@/features/clock/hooks";
import { AUTO_APPROVE_TITLE, autoApproveHint } from "@/features/clock/autoApprove";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button, Card } from "../ui/primitives";
import { useToast } from "../ui/Toast";

export function ClockMethodCard({
  venue,
  embedded = false,
}: {
  venue: Venue;
  /** Nel modal sede usa il contenitore del pannello. */
  embedded?: boolean;
}) {
  const save = useSetVenueClockMethod();
  const saveAuto = useSetVenueClockAutoApprove();
  const toast = useToast();
  const appEnabled = venue.clock_method === "app";
  const autoOn = venue.clock_auto_approve;

  const content = (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-gold">
            Timbrature
          </span>
          <h2 className="mt-1 font-serif text-lg text-t1">
            Metodo predefinito
          </h2>
          <p className="mt-1 text-sm leading-5 text-t3">
            {appEnabled
              ? "Timbratura dall’app: i dipendenti timbrano entrata e uscita dal telefono."
              : "Nessuna timbratura: le ore del turno concluso si contano automaticamente e chi gestisce può correggerle."}
          </p>
          <p className="mt-1 text-xs leading-5 text-t4">
            Vale solo per {venue.name} e per chi usa «Come la sede». Le
            scelte fatte per le singole persone non cambiano.
          </p>
        </div>
        <Button
          type="button"
          variant={appEnabled ? "ghost" : "gold"}
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                venueId: venue.id,
                method: appEnabled ? "manual" : "app",
              },
              {
                onSuccess: () =>
                  toast.show(
                    appEnabled
                      ? `Timbratura disattivata per ${venue.name}`
                      : `Timbratura dall’app attivata per ${venue.name}`
                  ),
                onError: (error) =>
                  toast.show(userErrorMessage(error), "error"),
              }
            )
          }
        >
          {save.isPending
            ? "Salvataggio…"
            : appEnabled
              ? "Disattiva la timbratura"
              : "Attiva la timbratura dall’app"}
        </Button>
      </div>

      {/* Solo per chi timbra dall'app: senza timbratura le ore valgono già. */}
      {appEnabled ? (
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-border-2 pt-5">
          <div className="max-w-2xl">
            <h3 className="font-semibold text-t1">{AUTO_APPROVE_TITLE}</h3>
            <p className="mt-1 text-sm leading-5 text-t3">{autoApproveHint(autoOn)}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoOn}
            aria-label={`${AUTO_APPROVE_TITLE} a ${venue.name}`}
            disabled={saveAuto.isPending}
            onClick={() =>
              saveAuto.mutate(
                { venueId: venue.id, on: !autoOn },
                {
                  onSuccess: () =>
                    toast.show(
                      autoOn
                        ? "Ogni timbratura va approvata"
                        : "Le timbrature in orario si approvano da sole"
                    ),
                  onError: (error) => toast.show(userErrorMessage(error), "error"),
                }
              )
            }
            className={cn(
              "focus-gold relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
              autoOn ? "bg-gold" : "bg-bg-3"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-t1 transition-all",
                autoOn ? "left-[1.375rem]" : "left-0.5"
              )}
            />
          </button>
        </div>
      ) : null}
    </section>
  );

  return embedded ? content : <Card className="mt-6 max-w-2xl">{content}</Card>;
}
