import { useMemo, useState } from "react";
import type { Message } from "@/features/chat/api";
import {
  useChangeRequest,
  useWithdrawShiftChangeRequest,
  useResolveShiftChangeRequest,
} from "@/features/changeRequests/hooks";
import { useShift } from "@/features/shifts/hooks";
import { useShiftAssignments } from "@/features/assignments/hooks";
import { isActiveAssignment } from "@/features/assignments/status";
import { useVenueStaff } from "@/features/staff/hooks";
import { userErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Pill, Select } from "../ui/primitives";

const STATUS_LABEL: Record<string, string> = {
  pending: "In attesa",
  approved: "Approvata",
  rejected: "Rifiutata",
  withdrawn: "Ritirata",
};

/**
 * La richiesta di cambio turno dentro il thread, versione web.
 *
 * ⚠️ Seconda implementazione della stessa card: la bolla del messaggio **non** è
 * condivisa tra app e dashboard (lo è solo la logica, in `useChatThread`). Se
 * cambia il comportamento di una, l'altra va guardata — le due sorgenti sono
 * `src/features/changeRequests/ChangeRequestCard.tsx` e questa.
 */
export function ChangeRequestCard({
  message,
  userId,
  own,
}: {
  message: Message;
  userId: string;
  own: boolean;
}) {
  const toast = useToast();
  const query = useChangeRequest(message.request_id);
  const request = query.data ?? null;
  const withdraw = useWithdrawShiftChangeRequest();
  const resolve = useResolveShiftChangeRequest();
  const [replacement, setReplacement] = useState("");

  const isRequester = request?.requested_by === userId;
  const pending = request?.status === "pending";
  const isResponse = message.kind === "shift_change_response";
  // «Ci sono, ma su un altro orario»: nessun sostituto da scegliere, e
  // accettare non sposta niente — è un accordo che il titolare applica poi dal
  // pannello del turno (migration 20260915140000).
  const isHours = request?.kind === "hours";
  const deciding = !!request && pending && !isRequester && !isResponse;
  // Le liste dell'organico servono solo a chi deve scegliere un sostituto, e
  // solo finché la richiesta è aperta: senza `enabled` ogni card vecchia del
  // thread farebbe tre query per niente.
  const picking = deciding && !isHours;

  const shiftQuery = useShift(request?.shift_id ?? "", picking);
  const staffQuery = useVenueStaff(
    picking ? shiftQuery.data?.venue_id : undefined
  );
  const assignmentsQuery = useShiftAssignments(request?.shift_id ?? "", picking);

  const candidates = useMemo(() => {
    const busy = new Set(
      (assignmentsQuery.data ?? [])
        .filter((a) => isActiveAssignment(a.status))
        .map((a) => a.venue_member_id)
    );
    return (staffQuery.data ?? []).filter(
      (m) => m.link_status === "active" && !busy.has(m.id)
    );
  }, [assignmentsQuery.data, staffQuery.data]);

  if (!query.isLoading && !request) {
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

  function decide(approve: boolean) {
    if (!request) return;
    resolve.mutate(
      {
        requestId: request.id,
        approve,
        replacementStaffMemberId: approve ? replacement || null : null,
      },
      {
        onSuccess: () =>
          toast.show(approve ? "Cambio approvato" : "Richiesta rifiutata"),
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Operazione non riuscita. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-[70%] rounded-2xl border px-4 py-3",
        pending ? "border-gold/40 bg-gold/5" : "border-border-2 bg-bg-1",
        own ? "self-end" : "self-start"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gold">
          {isResponse
            ? "Esito richiesta"
            : isHours
              ? "Richiesta di orario"
              : "Richiesta di cambio"}
        </span>
        {request ? (
          <Pill
            tone={
              request.status === "approved"
                ? "success"
                : request.status === "pending"
                  ? "gold"
                  : "neutral"
            }
          >
            {STATUS_LABEL[request.status] ?? request.status}
          </Pill>
        ) : null}
      </div>

      {request ? (
        <p className="mt-1.5 text-xs text-t4">
          Turno del {formatDate(request.shift_date)}
        </p>
      ) : null}

      <p className="mt-1 text-sm whitespace-pre-wrap text-t1">
        {message.content}
      </p>

      {deciding ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {picking ? (
              <Select
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                className="w-48"
                disabled={resolve.isPending}
              >
                <option value="">Nessun sostituto</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              type="button"
              variant="gold"
              disabled={resolve.isPending}
              onClick={() => decide(true)}
            >
              {isHours
                ? "Accetta l'orario"
                : replacement
                  ? "Approva e sostituisci"
                  : "Approva"}
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
          {isHours ? (
            <p className="mt-2 text-xs text-t4">
              L&apos;accordo resta scritto qui. L&apos;orario del turno lo
              aggiorni tu dal Planning: non cambia nulla da solo.
            </p>
          ) : null}
        </>
      ) : null}

      {!isResponse && pending && isRequester ? (
        <Button
          type="button"
          className="mt-3"
          disabled={withdraw.isPending}
          onClick={() =>
            request &&
            withdraw.mutate(request.id, {
              onSuccess: () => toast.show("Richiesta ritirata"),
              onError: (e) =>
                toast.show(
                  userErrorMessage(e, "Operazione non riuscita."),
                  "error"
                ),
            })
          }
        >
          Ritira la richiesta
        </Button>
      ) : null}
    </div>
  );
}
