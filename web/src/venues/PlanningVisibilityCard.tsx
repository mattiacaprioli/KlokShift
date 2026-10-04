import type { Venue } from "@/features/venues/api";
import { useSetVenueSeesPlanning } from "@/features/planning/hooks";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { Card } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * «Planning visibile all'organico» — gemella di `VenuePlanningToggle` nell'app.
 *
 * Salva al clic, fuori dal modulo della sede: è un interruttore, e farlo
 * passare da «Modifica → Salva» lo nasconderebbe dietro due clic.
 */
export function PlanningVisibilityCard({ venue }: { venue: Venue }) {
  const save = useSetVenueSeesPlanning();
  const toast = useToast();
  const on = venue.staff_sees_planning;

  function toggle() {
    save.mutate(
      { venueId: venue.id, visible: !on },
      {
        onSuccess: () =>
          toast.show(
            on
              ? "Planning non più visibile all'organico"
              : "L'organico vede il planning"
          ),
        onError: (error) => toast.show(userErrorMessage(error), "error"),
      }
    );
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-gold">
            Organico
          </span>
          <h2 className="mt-1 font-serif text-lg text-t1">
            Planning visibile all&apos;organico
          </h2>
          <p className="mt-1 text-sm leading-5 text-t3">
            {on
              ? "Chi è in organico vede i turni di questa sede e chi ci lavora."
              : "Chi è in organico vede solo i propri turni."}
          </p>
          <p className="mt-1 text-xs leading-5 text-t4">
            Restano privati numeri di telefono, note, documenti e ore. Non
            vengono mai mostrati i rifiuti né le assenze.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Planning visibile all'organico"
          disabled={save.isPending}
          onClick={toggle}
          className={cn(
            "focus-gold relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
            on ? "bg-gold" : "bg-bg-3"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-t1 transition-all",
              on ? "left-[1.375rem]" : "left-0.5"
            )}
          />
        </button>
      </div>
    </Card>
  );
}
