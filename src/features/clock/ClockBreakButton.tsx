import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import { useClockBreak } from "./hooks";

/**
 * Inizio e fine pausa sulla propria timbratura aperta, con o senza turno. In
 * pausa è l'azione principale (oro); in servizio è secondaria, sotto l'uscita.
 * Solo l'inizio chiede conferma: un tocco per sbaglio aprirebbe una pausa che
 * poi vale più di quella pianificata. Uscire in pausa la chiude da sé.
 */
export function ClockBreakButton({
  recordId,
  onBreak,
  className,
}: {
  recordId: string;
  /** C'è una pausa aperta adesso. */
  onBreak: boolean;
  className?: string;
}) {
  const toast = useToast();
  const clockBreak = useClockBreak();
  const [confirming, setConfirming] = useState(false);

  function run(action: "start" | "end") {
    clockBreak.mutate(
      { recordId, action },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.show(action === "start" ? "Pausa iniziata" : "Pausa finita");
        },
        onError: (error) => {
          setConfirming(false);
          toast.show(
            userErrorMessage(error, "Impossibile registrare la pausa. Riprova."),
            "error"
          );
        },
      }
    );
  }

  return (
    <>
      {onBreak ? (
        <GoldButton
          className={className}
          label={clockBreak.isPending ? "Registrazione…" : "Fine pausa"}
          disabled={clockBreak.isPending}
          onPress={() => run("end")}
        />
      ) : (
        <GhostButton
          className={className}
          label="Inizia pausa"
          disabled={clockBreak.isPending}
          onPress={() => setConfirming(true)}
        />
      )}
      <ConfirmModal
        visible={confirming}
        title="Iniziare la pausa?"
        message="Verrà registrato l’orario corrente del server. Quando riprendi, tocca «Fine pausa»."
        confirmLabel="Inizia pausa"
        pending={clockBreak.isPending}
        onConfirm={() => run("start")}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
