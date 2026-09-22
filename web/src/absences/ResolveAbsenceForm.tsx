import { useState } from "react";
import type { Absence, AbsenceStatus } from "@/features/absences/api";
import {
  useAbsenceConflicts,
  useRemoveFromShifts,
  useResolveAbsence,
} from "@/features/absences/hooks";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Input } from "../ui/primitives";
import { ConflictShiftList } from "./AbsenceConflicts";

/** Il tono della pill di stato sulla dashboard. */
export function absencePillTone(
  status: AbsenceStatus
): "gold" | "success" | "neutral" {
  if (status === "pending") return "gold";
  if (status === "approved") return "success";
  return "neutral";
}

/**
 * Approva o rifiuta una richiesta di ferie o permesso, con una nota facoltativa.
 * La usano la card in chat e il blocco «Richieste» della home.
 *
 * Approvare non toglie nessuno dai turni da solo: i turni in conflitto si
 * mostrano, e toglierli è un bottone a parte.
 */
export function ResolveAbsenceForm({
  absence,
  className,
}: {
  absence: Absence;
  className?: string;
}) {
  const toast = useToast();
  const resolve = useResolveAbsence();
  const remove = useRemoveFromShifts();
  const { conflicts } = useAbsenceConflicts(absence);
  const [note, setNote] = useState("");
  const busy = resolve.isPending || remove.isPending;

  function decide(approve: boolean, clearShifts = false) {
    resolve.mutate(
      { absenceId: absence.id, approve, note },
      {
        onSuccess: async () => {
          // Prima la decisione, poi i turni: se la seconda fallisce la richiesta
          // è comunque approvata, e i turni si tolgono dal blocco dei conflitti.
          if (clearShifts && conflicts.length > 0) {
            try {
              await remove.mutateAsync(conflicts.map((c) => c.assignmentId));
            } catch (e) {
              toast.show(
                `Richiesta approvata. ${userErrorMessage(e, "Non siamo riusciti a verificare la rimozione dai turni. Controlla l’elenco aggiornato.")}`,
                "error"
              );
              return;
            }
          }
          toast.show(
            !approve
              ? "Richiesta rifiutata"
              : clearShifts
                ? "Approvata: turni liberati"
                : "Richiesta approvata"
          );
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Operazione non riuscita. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {conflicts.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-semibold text-warning">
            {conflicts.length === 1
              ? "In quei giorni è in turno"
              : `In quei giorni è in ${conflicts.length} turni`}
          </p>
          <ConflictShiftList shifts={conflicts} />
        </div>
      ) : null}
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nota per chi ha chiesto (facoltativa)"
        maxLength={300}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        {conflicts.length > 0 ? (
          <>
            <Button
              type="button"
              variant="gold"
              disabled={busy}
              onClick={() => decide(true, true)}
            >
              Approva e togli dai turni
            </Button>
            <Button type="button" disabled={busy} onClick={() => decide(true)}>
              Approva, i turni li sistemo io
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="gold"
            disabled={busy}
            onClick={() => decide(true)}
          >
            Approva
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          disabled={busy}
          onClick={() => decide(false)}
        >
          Rifiuta
        </Button>
      </div>
    </div>
  );
}
