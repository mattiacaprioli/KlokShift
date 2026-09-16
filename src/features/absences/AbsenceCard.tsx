import { useState } from "react";
import { Pressable, Text, View } from "@/tw";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { Message } from "@/features/chat/api";
import { useAbsence, useWithdrawAbsence } from "./hooks";
import {
  ABSENCE_KIND_LABEL,
  ABSENCE_STATUS_LABEL,
  absenceStatusTone,
  canWithdrawAbsence,
  formatAbsenceRange,
} from "./labels";
import { ResolveAbsenceModal } from "./ResolveAbsenceModal";

/**
 * Ferie, permesso o malattia **dentro il thread di chat**, al posto della bolla.
 *
 * Gemella di `ChangeRequestCard`: stato letto per id (non da un join sui
 * messaggi), bottoni di chi deve decidere sulla card della richiesta, riga di
 * servizio per l'esito.
 *
 * ⚠️ Seconda implementazione in `web/src/chat/AbsenceCard.tsx`.
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
  const [resolving, setResolving] = useState(false);

  // L'assenza non c'è più (persona cancellata): resta il testo scritto.
  if (!query.isLoading && !absence) {
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

  const isRequester = absence?.requested_by === userId;
  const pending = absence?.status === "pending";
  const isResponse = message.kind === "absence_response";
  const sick = absence?.kind === "malattia";

  function onWithdraw() {
    if (!absence) return;
    withdraw.mutate(absence.id, {
      onSuccess: () => toast.show("Richiesta ritirata"),
      onError: (e) =>
        toast.show(userErrorMessage(e, "Operazione non riuscita."), "error"),
    });
  }

  const title = isResponse
    ? "Esito assenza"
    : sick
      ? "Malattia comunicata"
      : `Richiesta di ${absence ? ABSENCE_KIND_LABEL[absence.kind].toLowerCase() : "assenza"}`;

  return (
    <>
      <View
        className={cn(
          "w-full max-w-[85%] rounded-2xl border px-4 py-3.5",
          pending && !isResponse
            ? "border-gold/40 bg-gold/5"
            : "border-border-2 bg-bg-1",
          own ? "self-end" : "self-start"
        )}
      >
        <View className="flex-row items-center gap-2">
          <Icon name="calendar" size={16} color="#EAB54C" />
          <Text className="flex-1 text-[13px] font-sans-bold uppercase tracking-wider text-gold">
            {title}
          </Text>
          {absence && !isResponse ? (
            <Pill
              label={ABSENCE_STATUS_LABEL[absence.status]}
              variant={absenceStatusTone(absence.status)}
            />
          ) : null}
        </View>

        {absence && !isResponse ? (
          <Text className="mt-2 text-xs text-t3">
            {formatAbsenceRange(absence)}
          </Text>
        ) : null}

        <Text className="mt-1.5 text-[15px] leading-5 text-t1">
          {message.content}
        </Text>

        {absence && sick && !isResponse ? (
          <Text className="mt-1.5 text-xs text-t3">
            {absence.inps_protocol
              ? `Protocollo INPS ${absence.inps_protocol}`
              : "Protocollo INPS non ancora indicato"}
          </Text>
        ) : null}

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

        {!isResponse && absence && isRequester && canWithdrawAbsence(absence) ? (
          <Pressable
            onPress={onWithdraw}
            disabled={withdraw.isPending}
            className="mt-3 items-center rounded-xl border border-border py-2.5"
          >
            <Text className="text-sm font-sans-semibold text-t2">
              {withdraw.isPending
                ? "Attendere…"
                : pending
                  ? "Ritira la richiesta"
                  : "Annulla l'assenza"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {absence && resolving ? (
        <ResolveAbsenceModal
          absence={absence}
          onClose={() => setResolving(false)}
        />
      ) : null}
    </>
  );
}
