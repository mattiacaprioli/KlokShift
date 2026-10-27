import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Input } from "@/components/ui/Input";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { Text } from "@/tw";
import { useRespondToAssignment } from "./hooks";

/** Lo stesso tetto della colonna `shift_assignments.decline_reason`. */
const REASON_MAX = 300;

/**
 * «Rifiutare il turno?», la stessa conferma da Home, agenda e dettaglio (prima
 * erano tre copie).
 *
 * Dice anche come si torna indietro: il turno rifiutato resta in agenda come
 * «Rifiutato», e dal dettaglio «Ci sono, conferma» lo riprende. Chi gestisce
 * viene avvisato sia del rifiuto sia del ripensamento
 * (`notify_on_assignment_reconfirmed`), perché nel frattempo potrebbe aver
 * messo qualcun altro.
 *
 * Il motivo è facoltativo: rifiutare un turno non ancora confermato è una
 * risposta, non una richiesta da decidere (lì il motivo è obbligatorio). Se
 * c'è, arriva nella notifica e accanto a «Rifiutato». Come per la malattia, un
 * motivo di salute non serve scriverlo.
 */
export function DeclineShiftModal({
  assignmentId,
  onClose,
}: {
  /** L'assegnazione da rifiutare; `null` = finestra chiusa. */
  assignmentId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const respond = useRespondToAssignment();
  const [reason, setReason] = useState("");

  function close() {
    setReason("");
    onClose();
  }

  function onConfirm() {
    if (!assignmentId) return;
    respond.mutate(
      { id: assignmentId, status: "declined", reason: reason.trim() || null },
      {
        onSuccess: () => {
          close();
          toast.show("Turno rifiutato");
        },
        onError: (e) => {
          close();
          toast.show(
            userErrorMessage(e, "Operazione non riuscita. Riprova."),
            "error"
          );
        },
      }
    );
  }

  return (
    <ConfirmModal
      visible={assignmentId != null}
      title="Rifiutare il turno?"
      message="La sede verrà avvisata. Il turno resta nella tua agenda come «Rifiutato»: se ci ripensi, aprilo e tocca «Ci sono, conferma»."
      confirmLabel="Rifiuta"
      destructive
      pending={respond.isPending}
      onConfirm={onConfirm}
      onCancel={close}
    >
      <Input
        label="Motivo (facoltativo)"
        value={reason}
        onChangeText={setReason}
        placeholder="Es. ho già un altro impegno"
        maxLength={REASON_MAX}
        editable={!respond.isPending}
      />
      <Text className="mt-2 text-xs leading-4 text-t3">
        Lo legge chi gestisce i turni. Un motivo di salute non serve scriverlo.
      </Text>
    </ConfirmModal>
  );
}
