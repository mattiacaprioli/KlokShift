import type { Venue } from "@/features/venues/api";
import { useSetVenueClockMethod } from "@/features/clock/hooks";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card } from "../ui/primitives";
import { useToast } from "../ui/Toast";

export function ClockMethodCard({ venue }: { venue: Venue }) {
  const save = useSetVenueClockMethod();
  const toast = useToast();
  const appEnabled = venue.clock_method === "app";

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-serif text-lg text-t1">Timbrature</h2>
          <p className="mt-1 text-sm leading-5 text-t3">
            {appEnabled
              ? "I professionisti assegnati possono timbrare entrata e uscita dall’app. Le ore restano da verificare prima di diventare definitive."
              : "Gli orari vengono inseriti manualmente da chi gestisce. Abilita il pulsante nell’app per raccogliere entrata e uscita."}
          </p>
        </div>
        <Button
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
                      ? "Timbratura manuale attivata"
                      : "Timbratura dall’app attivata"
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
              ? "Usa inserimento manuale"
              : "Abilita timbratura app"}
        </Button>
      </div>
    </Card>
  );
}
