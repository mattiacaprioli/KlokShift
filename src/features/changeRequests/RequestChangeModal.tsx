import { useState } from "react";
import { Modal, ScrollView } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { userErrorMessage } from "@/lib/errors";
import { timeToDate, toTimeString } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { TimeField } from "@/features/shifts/TimeField";
import { useRequestShiftChange } from "./hooks";
import type { ChangeRequestKind } from "./api";
import { HOURS_WITH_CONFIRM_LABEL, REQUEST_CHANGE_LABEL } from "./labels";

const KINDS = [
  { id: "substitution" as const, label: "Non posso venire" },
  { id: "hours" as const, label: "Orario diverso" },
];

/**
 * Cosa chiede il dipendente sul proprio turno, dopo averlo confermato (e
 * l'unica strada del dipendente fisso, la cui assegnazione nasce confermata).
 *
 * Due richieste diverse, non due gradi della stessa: «non posso venire» chiede a
 * qualcun altro di coprire, «orario diverso» dice che ci sarà comunque. Tenerle
 * separate evita che chi voleva solo uscire un'ora prima chieda di essere tolto
 * dal turno — cioè una cosa più grossa di quella che intendeva.
 *
 * Il motivo è sempre obbligatorio: la richiesta arriva come card in chat, e
 * senza il perché il titolare non può decidere — dovrebbe scrivere per chiedere,
 * e a quel punto tanto valeva scrivere e basta.
 *
 * `withConfirm`: la stessa richiesta d'orario, ma come risposta a un turno
 * ancora da confermare («Ci sono, ma a un altro orario»). Niente scelta del
 * tipo — «non posso» lì è il rifiuto — e dopo l'invio chi apre la finestra
 * conferma la presenza (`onSent`). Va montata solo quando si apre: lo stato
 * iniziale dipende da come la si apre.
 */
export function RequestChangeModal({
  visible,
  assignmentId,
  shiftLabel,
  shiftStart,
  shiftEnd,
  withConfirm = false,
  onSent,
  onClose,
}: {
  visible: boolean;
  assignmentId: string;
  /** Es. «venerdì 20/09». Solo per la frase di contesto. */
  shiftLabel: string;
  /** Orario del turno, da cui partono i due campi: "HH:MM[:SS]". */
  shiftStart: string;
  shiftEnd: string;
  /** Risposta a un turno da confermare: solo orario, poi la conferma. */
  withConfirm?: boolean;
  /** Dopo l'invio, al posto del toast: il passo dopo lo fa chi apre la finestra. */
  onSent?: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<ChangeRequestKind>(
    withConfirm ? "hours" : "substitution"
  );
  const [reason, setReason] = useState("");
  const [start, setStart] = useState(() => timeToDate(shiftStart));
  const [end, setEnd] = useState(() => timeToDate(shiftEnd));
  const request = useRequestShiftChange();

  const sameTime = toTimeString(start) === toTimeString(end);
  const canSend =
    reason.trim().length > 0 &&
    !request.isPending &&
    (kind === "substitution" || !sameTime);

  function onSend() {
    request.mutate(
      {
        assignmentId,
        reason: reason.trim(),
        kind,
        startTime: toTimeString(start),
        endTime: toTimeString(end),
      },
      {
        onSuccess: () => {
          setReason("");
          onClose();
          if (onSent) onSent();
          else toast.show("Richiesta inviata alla sede");
        },
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Richiesta non inviata. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={request.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[85%] w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {withConfirm ? HOURS_WITH_CONFIRM_LABEL : REQUEST_CHANGE_LABEL}
          </Text>
          <Text className="mt-2 text-sm leading-5 text-t2">
            {withConfirm
              ? `Confermi la presenza e chiedi un orario diverso. La sede decide in chat: fino ad allora il turno di ${shiftLabel} resta come sta.`
              : `La sede riceve la richiesta in chat e decide: fino ad allora il turno di ${shiftLabel} resta come sta.`}
          </Text>

          <ScrollView
            className="mt-5"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {withConfirm ? null : (
              <Segmented options={KINDS} value={kind} onChange={setKind} />
            )}

            {kind === "hours" ? (
              <View className={withConfirm ? "gap-2.5" : "mt-5 gap-2.5"}>
                <View className="flex-row gap-4">
                  <TimeField
                    className="flex-1"
                    label="Dalle"
                    value={start}
                    onChange={setStart}
                  />
                  <TimeField
                    className="flex-1"
                    label="Alle"
                    value={end}
                    onChange={setEnd}
                  />
                </View>
                <Text
                  className={
                    sameTime
                      ? "text-xs font-sans-semibold text-error"
                      : "text-xs text-t3"
                  }
                >
                  {sameTime
                    ? "Inizio e fine coincidono: correggi l'orario."
                    : "Se la sede accetta, aggiorna il turno: l'accordo resta scritto qui."}
                </Text>
              </View>
            ) : null}

            <View className="mt-5">
              <Input
                label="Motivo"
                value={reason}
                onChangeText={setReason}
                placeholder={
                  kind === "hours"
                    ? "Es. devo accompagnare mio figlio"
                    : "Es. visita medica quella sera"
                }
                multiline
                numberOfLines={3}
                className="h-24"
                textAlignVertical="top"
                maxLength={500}
              />
            </View>
          </ScrollView>

          <View className="mt-6 gap-2.5">
            <GoldButton
              label={
                request.isPending
                  ? "Invio…"
                  : withConfirm
                    ? "Conferma e invia"
                    : "Invia richiesta"
              }
              disabled={!canSend}
              onPress={onSend}
            />
            <Pressable
              onPress={onClose}
              disabled={request.isPending}
              className="items-center rounded-xl border border-border py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-t2">Annulla</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
