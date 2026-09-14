import { useState } from "react";
import { Pressable, Text, View } from "@/tw";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { Message } from "@/features/chat/api";
import { useChangeRequest, useWithdrawShiftChangeRequest } from "./hooks";
import { ResolveRequestModal } from "./ResolveRequestModal";

const STATUS_LABEL: Record<string, string> = {
  pending: "In attesa",
  approved: "Approvata",
  rejected: "Rifiutata",
  withdrawn: "Ritirata",
};

/**
 * La richiesta di cambio turno **dentro il thread di chat**.
 *
 * Al posto della bolla di testo, per i messaggi con `kind <> 'text'`: la
 * richiesta si legge dove è stata fatta, e i due bottoni del titolare stanno lì
 * invece che in una schermata a parte da andare a cercare.
 *
 * ⚠️ Lo stato arriva da una query per id, **non** da un join sui messaggi: il
 * realtime della chat mette in cache la riga grezza di `postgres_changes`, che
 * un embed non ce l'ha mai (vedi `useChangeRequest`).
 */
export function ChangeRequestCard({
  message,
  userId,
  own,
}: {
  message: Message;
  /** L'utente che sta guardando il thread. */
  userId: string;
  own: boolean;
}) {
  const toast = useToast();
  const query = useChangeRequest(message.request_id);
  const request = query.data ?? null;
  const withdraw = useWithdrawShiftChangeRequest();
  const [resolving, setResolving] = useState(false);

  // La richiesta è stata cancellata insieme al turno: resta il testo scritto.
  if (!query.isLoading && !request) {
    return (
      <View
        className={cn(
          "max-w-[85%] rounded-2xl border border-border-2 bg-bg-1 px-3.5 py-2.5",
          own ? "self-end" : "self-start"
        )}
      >
        <Text className="text-[15px] text-t2">{message.content}</Text>
      </View>
    );
  }

  const isRequester = request?.requested_by === userId;
  const pending = request?.status === "pending";
  // «Ci sono, ma su un altro orario»: nessun sostituto da scegliere, e
  // approvare non sposta niente — è un accordo che il titolare applica poi dal
  // pannello del turno (migration 20260915140000).
  const isHours = request?.kind === "hours";
  // Il messaggio di esito è una riga di servizio: la card completa (motivo,
  // bottoni) è quella della richiesta, ripeterla due volte nel thread
  // racconterebbe la stessa cosa due volte.
  const isResponse = message.kind === "shift_change_response";

  function onWithdraw() {
    if (!request) return;
    withdraw.mutate(request.id, {
      onSuccess: () => toast.show("Richiesta ritirata"),
      onError: (e) =>
        toast.show(userErrorMessage(e, "Operazione non riuscita."), "error"),
    });
  }

  return (
    <>
      <View
        className={cn(
          "w-full max-w-[85%] rounded-2xl border px-4 py-3.5",
          pending ? "border-gold/40 bg-gold/5" : "border-border-2 bg-bg-1",
          own ? "self-end" : "self-start"
        )}
      >
        <View className="flex-row items-center gap-2">
          <Icon name={isHours ? "clock" : "users"} size={16} color="#EAB54C" />
          <Text className="flex-1 text-[13px] font-sans-bold uppercase tracking-wider text-gold">
            {isResponse
              ? "Esito richiesta"
              : isHours
                ? "Richiesta di orario"
                : "Richiesta di cambio"}
          </Text>
          {request ? (
            <Pill
              label={STATUS_LABEL[request.status] ?? request.status}
              variant={
                request.status === "approved"
                  ? "accepted"
                  : request.status === "pending"
                    ? "pending"
                    : "cancelled"
              }
            />
          ) : null}
        </View>

        {request ? (
          <Text className="mt-2 text-xs text-t3">
            Turno del {formatDate(request.shift_date)}
          </Text>
        ) : null}

        <Text className="mt-1.5 text-[15px] leading-5 text-t1">
          {message.content}
        </Text>

        {!isResponse && pending && !isRequester ? (
          <Pressable
            onPress={() => setResolving(true)}
            className="mt-3 items-center rounded-xl bg-gold py-2.5"
          >
            <Text
              className="text-sm font-sans-bold"
              style={{ color: "#1A1206" }}
            >
              Rispondi alla richiesta
            </Text>
          </Pressable>
        ) : null}

        {!isResponse && pending && isRequester ? (
          <Pressable
            onPress={onWithdraw}
            disabled={withdraw.isPending}
            className="mt-3 items-center rounded-xl border border-border py-2.5"
          >
            <Text className="text-sm font-sans-semibold text-t2">
              {withdraw.isPending ? "Attendere…" : "Ritira la richiesta"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {request && resolving ? (
        <ResolveRequestModal
          visible
          request={request}
          onClose={() => setResolving(false)}
        />
      ) : null}
    </>
  );
}
