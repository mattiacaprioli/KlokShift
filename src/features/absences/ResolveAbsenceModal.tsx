import { useState } from "react";
import { Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Input } from "@/components/ui/Input";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useResolveAbsence } from "./hooks";
import type { Absence } from "./api";
import { ABSENCE_KIND_LABEL, formatAbsenceRange } from "./labels";

/**
 * La decisione su una richiesta di ferie o permesso.
 *
 * Approvare **non** toglie la persona dai turni che cadono nell'assenza: come
 * per le richieste di orario, un tap su «Approva» non cancella assegnazioni come
 * effetto collaterale. I turni si sistemano poi dal planning.
 */
export function ResolveAbsenceModal({
  absence,
  personName,
  onClose,
}: {
  absence: Absence;
  /** Il nome della persona, quando chi apre il modal non è nel thread. */
  personName?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const resolve = useResolveAbsence();
  const [note, setNote] = useState("");

  function decide(approve: boolean) {
    resolve.mutate(
      { absenceId: absence.id, approve, note },
      {
        onSuccess: () => {
          onClose();
          toast.show(approve ? "Richiesta approvata" : "Richiesta rifiutata");
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
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={resolve.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        className="items-center justify-center px-6"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {ABSENCE_KIND_LABEL[absence.kind]}
            {personName ? ` · ${personName}` : ""}
          </Text>
          <Text className="mt-1 text-sm text-t2">
            {formatAbsenceRange(absence)}
          </Text>
          {absence.note ? (
            <Text className="mt-3 text-[15px] leading-5 text-t1">
              {absence.note}
            </Text>
          ) : null}
          <Text className="mt-3 text-xs leading-4 text-t3">
            Approvare non toglie nessuno dai turni: se serve, sistemali tu dal
            planning.
          </Text>

          <View className="mt-4">
            <Input
              label="Nota (facoltativa)"
              value={note}
              onChangeText={setNote}
              placeholder="Visibile a chi ha chiesto"
              maxLength={300}
            />
          </View>

          <View className="mt-6 gap-2.5">
            <GoldButton
              label={resolve.isPending ? "Attendere…" : "Approva"}
              disabled={resolve.isPending}
              onPress={() => decide(true)}
            />
            <Pressable
              onPress={() => decide(false)}
              disabled={resolve.isPending}
              className="items-center rounded-xl border border-border py-3.5"
            >
              <Text className="text-sm font-sans-semibold text-t2">
                Rifiuta la richiesta
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              disabled={resolve.isPending}
              className="items-center py-2"
            >
              <Text className="text-sm text-t4">Decidi dopo</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
