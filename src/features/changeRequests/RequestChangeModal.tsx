import { useState } from "react";
import { Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useRequestShiftChange } from "./hooks";

/**
 * «Chiedi sostituzione»: il gesto che resta al professionista dopo aver
 * confermato un turno (e l'unico che ha il dipendente fisso, la cui assegnazione
 * nasce già confermata).
 *
 * Il motivo è obbligatorio, e non per burocrazia: la richiesta arriva al
 * titolare come card in chat, e senza il perché non è decidibile — dovrebbe
 * scrivere per chiedere, e a quel punto tanto valeva scrivere e basta.
 */
export function RequestChangeModal({
  visible,
  assignmentId,
  shiftLabel,
  onClose,
}: {
  visible: boolean;
  assignmentId: string;
  /** Es. «venerdì 20/09». Solo per la frase di contesto. */
  shiftLabel: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const request = useRequestShiftChange();
  const canSend = reason.trim().length > 0 && !request.isPending;

  function onSend() {
    request.mutate(
      { assignmentId, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason("");
          onClose();
          toast.show("Richiesta inviata al locale");
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
        className="items-center justify-center px-8"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            Chiedi una sostituzione
          </Text>
          <Text className="mt-2 text-sm leading-5 text-t2">
            Il locale riceve la richiesta in chat e decide lui: fino ad allora il
            turno di {shiftLabel} resta tuo.
          </Text>

          <View className="mt-5">
            <Input
              label="Motivo"
              value={reason}
              onChangeText={setReason}
              placeholder="Es. visita medica quella sera"
              multiline
              numberOfLines={3}
              className="h-24"
              textAlignVertical="top"
              maxLength={500}
            />
          </View>

          <View className="mt-6 gap-2.5">
            <GoldButton
              label={request.isPending ? "Invio…" : "Invia richiesta"}
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
