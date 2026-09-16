import { useState } from "react";
import type { Absence, AbsenceStatus } from "@/features/absences/api";
import { useResolveAbsence } from "@/features/absences/hooks";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Input } from "../ui/primitives";

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
 * Approvare non toglie nessuno dai turni: si sistemano dal Planning.
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
  const [note, setNote] = useState("");

  function decide(approve: boolean) {
    resolve.mutate(
      { absenceId: absence.id, approve, note },
      {
        onSuccess: () =>
          toast.show(approve ? "Richiesta approvata" : "Richiesta rifiutata"),
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
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Nota per chi ha chiesto (facoltativa)"
        maxLength={300}
        disabled={resolve.isPending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="gold"
          disabled={resolve.isPending}
          onClick={() => decide(true)}
        >
          Approva
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={resolve.isPending}
          onClick={() => decide(false)}
        >
          Rifiuta
        </Button>
      </div>
      <p className="text-xs text-t4">
        Approvare non toglie nessuno dai turni: se serve, sistemali dal
        Planning.
      </p>
    </div>
  );
}
