import type { Venue } from "@/features/venues/api";
import { useSetVenueClockMethod } from "@/features/clock/hooks";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card } from "../ui/primitives";
import { useToast } from "../ui/Toast";

export function ClockMethodCard({
  venue,
  embedded = false,
}: {
  venue: Venue;
  /** Dentro il modulo sede non serve una seconda card né il nome ripetuto. */
  embedded?: boolean;
}) {
  const save = useSetVenueClockMethod();
  const toast = useToast();
  const appEnabled = venue.clock_method === "app";

  const content = (
    <section
      className={
        embedded ? "mt-6 border-t border-border-2 pt-5" : undefined
      }
    >
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
              ? "Metodo predefinito: App. I professionisti possono timbrare entrata e uscita dal telefono."
              : "Metodo predefinito: Manuale. Gli orari vengono inseriti da chi gestisce."}
          </p>
          <p className="mt-1 text-xs leading-5 text-t4">
            Vale solo per {venue.name} e per chi usa «Come la sede». Le
            impostazioni personali dello staff non cambiano.
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
                      ? `Metodo manuale attivato per ${venue.name}`
                      : `Timbratura app attivata per ${venue.name}`
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
              ? "Usa Manuale in questa sede"
              : "Usa App in questa sede"}
        </Button>
      </div>
    </section>
  );

  return embedded ? content : <Card className="mt-6 max-w-2xl">{content}</Card>;
}
