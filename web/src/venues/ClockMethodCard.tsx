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
  /** Nel modal sede usa il contenitore del pannello. */
  embedded?: boolean;
}) {
  const save = useSetVenueClockMethod();
  const toast = useToast();
  const appEnabled = venue.clock_method === "app";

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
    </section>
  );

  return embedded ? content : <Card className="mt-6 max-w-2xl">{content}</Card>;
}
