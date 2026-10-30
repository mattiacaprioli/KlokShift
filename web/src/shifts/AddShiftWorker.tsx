import { useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import type { AssignmentWithStaff } from "@/features/assignments/api";
import {
  ADD_WORKER_HINT,
  ADD_WORKER_LABEL,
  shiftWorkerCandidates,
} from "@/features/assignments/addWorker";
import { defaultRoleFor } from "@/features/assignments/defaultRole";
import { useAddShiftWorker } from "@/features/assignments/hooks";
import { staffRoleNames } from "@/features/staff/api";
import { useVenueStaff } from "@/features/staff/hooks";
import { useSelfStaff } from "@/features/staff/self";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { Button, Select } from "../ui/primitives";

/**
 * «Aggiungi chi ha lavorato», sotto le presenze di un turno finito: il
 * sostituto che nessuno aveva segnato (`add_shift_worker`). Gemello della
 * finestra dell'app (`AddShiftWorkerModal`), con la stessa scelta di chi
 * offrire (`shiftWorkerCandidates`).
 */
export function AddShiftWorker({
  shiftId,
  venueId,
  assignments,
}: {
  shiftId: string;
  venueId: string;
  /** Chi è già sul turno, rifiutati compresi. */
  assignments: AssignmentWithStaff[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const { isOwner } = useOwnerVenues();
  const self = useSelfStaff();
  // Il team si legge solo quando serve: il pulsante è su ogni turno finito.
  const staffQuery = useVenueStaff(open ? venueId : undefined);
  const add = useAddShiftWorker(shiftId);
  const candidates = shiftWorkerCandidates(
    staffQuery.data ?? [],
    assignments,
    // Le proprie ore le segna solo il titolare.
    (waiterId) => !isOwner && self.isSelf(waiterId)
  );
  const member = candidates.find((m) => m.id === picked);

  function close() {
    setOpen(false);
    setPicked("");
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="mt-2 px-3 py-1.5 text-xs">
        + {ADD_WORKER_LABEL}
      </Button>
    );
  }

  return (
    <div
      className="mt-2 rounded-xl bg-bg-2 p-3"
      onKeyDown={(event) => {
        // Salva con una RPC sua: Invio non deve inviare un form attorno.
        if (event.key === "Enter") event.preventDefault();
      }}
    >
      <p className="text-xs leading-5 text-t3">{ADD_WORKER_HINT}</p>
      {staffQuery.isLoading ? (
        <p className="mt-2 text-xs text-t4">Caricamento team…</p>
      ) : candidates.length === 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-t4">
            In questa sede non c&apos;è nessun altro nel team da aggiungere.
          </p>
          <Button type="button" onClick={close} className="px-3 py-1.5 text-xs">
            Chiudi
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Select
            aria-label="Chi ha lavorato"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            className="min-w-56 flex-1"
          >
            <option value="">Scegli la persona…</option>
            {candidates.map((m) => {
              const roles = staffRoleNames(m);
              return (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                  {roles ? ` · ${roles}` : ""}
                </option>
              );
            })}
          </Select>
          <Button
            type="button"
            variant="gold"
            disabled={!member || add.isPending}
            onClick={() => {
              if (!member) return;
              add.mutate(
                { venueMemberId: member.id, roleId: defaultRoleFor(member) },
                { onSuccess: close }
              );
            }}
          >
            {add.isPending ? "Aggiunta…" : "Aggiungi"}
          </Button>
          <Button type="button" onClick={close} disabled={add.isPending}>
            Annulla
          </Button>
        </div>
      )}
      {add.error ? (
        <p className="mt-2 text-xs text-error">{userErrorMessage(add.error)}</p>
      ) : null}
    </div>
  );
}
