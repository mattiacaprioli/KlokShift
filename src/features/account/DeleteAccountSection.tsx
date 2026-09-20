import { useState } from "react";
import { Text, View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useToast } from "@/providers/Toast";
import { deleteMyAccount } from "./api";

/**
 * "Elimina account" — obbligatoria per la pubblicazione sugli store (Google Play
 * User Data policy, Apple 5.1.1(v)): se si può creare un account, si deve poter
 * cancellare, da dentro l'app.
 *
 * La copy è diversa perché le conseguenze lo sono: il professionista perde la
 * reputazione ma la sede conserva le ore già lavorate; il titolare, se è
 * l'unico, chiude l'azienda e fa annullare i turni futuri, con lo storico
 * passato che resta. Il client non sa se ci sono altri titolari: lo dice il
 * testo, e il DB decide.
 */
export function DeleteAccountSection() {
  const { signOut } = useAuth();
  const { isOwner } = useOwnerVenues();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const message = isOwner
    ? "I tuoi dati personali verranno eliminati. Se sei l'unico titolare, l'azienda si chiude: le sedi vengono chiuse e i turni futuri annullati, con una notifica al personale assegnato; lo storico dei turni passati e delle ore resta, per gli obblighi contabili. Se ci sono altri titolari, esci e l'azienda continua. L'operazione non è reversibile."
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
        {isOwner
          ? "Eliminando l'account, se sei l'unico titolare l'azienda si chiude e i turni futuri vengono annullati."
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
