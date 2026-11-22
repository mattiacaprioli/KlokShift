import { useMemo } from "react";
import { recordAbsenceOptions } from "@/features/absences/recordFor";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";
import { Button } from "../ui/primitives";
import { RecordAbsenceForm } from "./AbsencesPanel";

/**
 * «Registra assenza» dalla pagina Assenze: la persona si sceglie qui. È anche
 * dove il titolare mette le proprie ferie, che non chiede a nessuno.
 *
 * ⚠️ Gemello app in `src/app/(manager)/staff/assenza/new.tsx`.
 */
export function RecordAbsenceDialog({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const { workspaceId, isOwner, can } = useOwnerVenues();
  const peopleQuery = useOwnerPeople(workspaceId);
  const myId = session?.user.id ?? "";
  const options = useMemo(
    () =>
      recordAbsenceOptions(peopleQuery.data ?? [], {
        myId,
        isOwner,
        canStaffOn: (venueId) => can(venueId, "can_manage_staff"),
      }),
    [peopleQuery.data, myId, isOwner, can]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Registra assenza"
        className="relative flex max-h-[min(90vh,44rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-2 bg-bg-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-2 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-xl text-t1">Registra assenza</h2>
            <p className="mt-1 max-w-md text-xs leading-4 text-t3">
              {isOwner
                ? "La malattia comunicata a voce, le ferie già concordate o le tue: nasce approvata, senza notifiche."
                : "La malattia comunicata a voce o le ferie già concordate: nasce approvata, senza notifiche."}
            </p>
          </div>
          <Button onClick={onClose} aria-label="Chiudi">
            Chiudi
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <RecordAbsenceForm
            bare
            people={{ options, loading: peopleQuery.isPending }}
            onDone={onClose}
          />
        </div>
      </div>
    </div>
  );
}
