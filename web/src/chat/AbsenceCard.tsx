import type { Message } from "@/features/chat/api";
import { useAbsence, useWithdrawAbsence } from "@/features/absences/hooks";
import {
  ABSENCE_KIND_LABEL,
  ABSENCE_STATUS_LABEL,
  canWithdrawAbsence,
  formatAbsenceRange,
} from "@/features/absences/labels";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Pill } from "../ui/primitives";
import { AbsenceConflictsBlock } from "../absences/AbsenceConflicts";
import { ResolveAbsenceForm, absencePillTone } from "../absences/ResolveAbsenceForm";

/**
 * Ferie, permesso o malattia dentro il thread, versione web.
 *
 * ⚠️ Seconda implementazione della card: la sorgente app è
 * `src/features/absences/AbsenceCard.tsx`. Se cambia il comportamento di una,
 * l'altra va guardata.
 */
export function AbsenceCard({
  message,
  userId,
  own,
}: {
  message: Message;
  userId: string;
  own: boolean;
}) {
  const toast = useToast();
  const query = useAbsence(message.absence_id);
  const absence = query.data ?? null;
  const withdraw = useWithdrawAbsence();

  if (!query.isLoading && !absence) {
    return (
      <div
        className={cn(
          "max-w-[70%] rounded-2xl border border-border-2 bg-bg-1 px-3.5 py-2.5 text-t2",
          own ? "self-end" : "self-start"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    );
  }

  const isRequester = absence?.requested_by === userId;
  const pending = absence?.status === "pending";
  const isResponse = message.kind === "absence_response";
  const sick = absence?.kind === "malattia";

  const title = isResponse
    ? "Esito assenza"
    : sick
      ? "Malattia comunicata"
      : `Richiesta di ${absence ? ABSENCE_KIND_LABEL[absence.kind].toLowerCase() : "assenza"}`;

  return (
    <div
      className={cn(
        "w-full max-w-[70%] rounded-2xl border px-4 py-3",
        pending && !isResponse
          ? "border-gold/40 bg-gold/5"
          : "border-border-2 bg-bg-1",
        own ? "self-end" : "self-start"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gold">
          {title}
        </span>
        {absence && !isResponse ? (
          <Pill tone={absencePillTone(absence.status)}>
            {ABSENCE_STATUS_LABEL[absence.status]}
          </Pill>
        ) : null}
      </div>

      {absence && !isResponse ? (
        <p className="mt-1.5 text-xs text-t4">{formatAbsenceRange(absence)}</p>
      ) : null}

      <p className="mt-1 text-sm whitespace-pre-wrap text-t1">
        {message.content}
      </p>

      {absence && sick && !isResponse ? (
        <p className="mt-1 text-xs text-t4">
          {absence.inps_protocol
            ? `Certificato medico · ${absence.inps_protocol}`
            : "Riferimento del certificato non ancora indicato"}
        </p>
      ) : null}

      {absence && !isResponse && !isRequester && absence.status === "approved" ? (
        <AbsenceConflictsBlock absence={absence} />
      ) : null}

      {absence && !isResponse && pending && !isRequester ? (
        <ResolveAbsenceForm absence={absence} className="mt-3" />
      ) : null}

      {absence && !isResponse && isRequester && canWithdrawAbsence(absence) ? (
        <Button
          type="button"
          className="mt-3"
          disabled={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(absence.id, {
              onSuccess: () => toast.show("Richiesta ritirata"),
              onError: (e) =>
                toast.show(
                  userErrorMessage(e, "Operazione non riuscita."),
                  "error"
                ),
            })
          }
        >
          {pending ? "Ritira la richiesta" : "Annulla l'assenza"}
        </Button>
      ) : null}
    </div>
  );
}
