import { useState } from "react";
import { Text, View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { deleteMyAccount } from "./api";

/**
 * "Elimina account" — obbligatoria per la pubblicazione sugli store (Google Play
 * User Data policy, Apple 5.1.1(v)): se si può creare un account, si deve poter
 * cancellare, da dentro l'app.
 *
 * La copy è diversa per ruolo perché le conseguenze lo sono: il cameriere perde
 * la reputazione ma la sede conserva le ore già lavorate; il
 * ristoratore chiude la sede e fa annullare i turni futuri, con lo storico
 * passato che resta alla sede.
 */
export function DeleteAccountSection() {
  const { profile, signOut } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const isManager = profile?.role === "manager";

  const message = isManager
    ? "I tuoi dati personali verranno eliminati e la tua sede chiusa. I turni futuri saranno annullati e il personale assegnato riceverà una notifica. Lo storico dei turni passati e delle ore resta alla sede, per gli obblighi contabili. L'operazione non è reversibile."
    : "I tuoi dati personali e le recensioni ricevute verranno eliminati. Le sedi per cui hai lavorato conservano le ore già registrate, senza più il tuo account collegato. L'operazione non è reversibile.";

  async function onConfirm() {
    setPending(true);
    try {
      await deleteMyAccount();
      setConfirming(false);
      // L'utente di autenticazione non esiste più: il signOut serve a ripulire
      // la sessione locale, così il RootNavigator torna al gruppo (auth).
      await signOut();
    } catch {
      setPending(false);
      toast.show("Impossibile eliminare l'account. Riprova.", "error");
    }
  }

  return (
    <View className="gap-2">
      <SectionHeader title="Zona pericolosa" />
      <Text className="text-[13px] leading-5 text-t3">
        {isManager
          ? "Eliminando l'account la sede viene chiusa e i turni futuri annullati."
          : "Eliminando l'account perdi profilo e recensioni."}
      </Text>
      <View className="mt-1">
        <GhostButton
          label="Elimina account"
          onPress={() => setConfirming(true)}
        />
      </View>

      <ConfirmModal
        visible={confirming}
        title="Eliminare l'account?"
        message={message}
        confirmLabel="Elimina"
        destructive
        pending={pending}
        onConfirm={onConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
