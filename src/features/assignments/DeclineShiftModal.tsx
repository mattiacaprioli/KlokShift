import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useRespondToAssignment } from "./hooks";

/**
 * «Rifiutare il turno?», la stessa conferma da Home, agenda e dettaglio (prima
 * erano tre copie).
 *
 * Dice anche come si torna indietro: il turno rifiutato resta in agenda come
 * «Rifiutato», e dal dettaglio «Ci sono, conferma» lo riprende. Chi gestisce
 * viene avvisato sia del rifiuto sia del ripensamento
 * (`notify_on_assignment_reconfirmed`), perché nel frattempo potrebbe aver
 * messo qualcun altro.
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

  function onConfirm() {
    if (!assignmentId) return;
    respond.mutate(
      { id: assignmentId, status: "declined" },
      {
        onSuccess: () => {
          onClose();
          toast.show("Turno rifiutato");
        },
        onError: (e) => {
          onClose();
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
      onCancel={onClose}
    />
  );
}
