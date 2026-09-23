import { useState } from "react";
import { Text, View } from "@/tw";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GhostButton } from "@/components/ui/GhostButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useToast } from "@/providers/Toast";
import { userErrorMessage } from "@/lib/errors";
import { deleteMyAccount } from "./api";

/**
 * "Elimina account" — obbligatoria per la pubblicazione sugli store (Google Play
 * User Data policy, Apple 5.1.1(v)): se si può creare un account, si deve poter
 * cancellare, da dentro l'app.
 *
 * La copy è diversa perché le conseguenze lo sono: la scheda nominativa resta
 * all'azienda e viene scollegata dall'account; il titolare, se è l'unico,
 * chiude l'azienda e fa annullare i turni futuri, con lo storico passato che
 * resta. Il client non sa se ci sono altri titolari: lo dice il testo, e il DB
 * decide.
 */
export function DeleteAccountSection() {
  const { signOut } = useAuth();
  const { isOwner } = useOwnerVenues();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const message = isOwner
    ? "Foto, recapiti del profilo e file caricati vengono rimossi; il nome del profilo diventa «Utente eliminato». Le schede nominative e lo storico restano alle aziende, scollegati dall'account. Se sei l'unico titolare, l'azienda si chiude: le sedi vengono chiuse e i turni futuri annullati, con una notifica al personale assegnato. Se ci sono altri titolari, esci e l'azienda continua. Al termine l'operazione non è reversibile."
    : "Foto, recapiti del profilo e file caricati vengono rimossi; il nome del profilo diventa «Utente eliminato». Le schede nominative, i documenti caricati da altri e lo storico restano alle aziende, scollegati dall'account. Al termine l'operazione non è reversibile.";

  async function onConfirm() {
    setPending(true);
    try {
      await deleteMyAccount();
      setConfirming(false);
      // L'utente di autenticazione non esiste più: il signOut serve a ripulire
      // la sessione locale, così il RootNavigator torna al gruppo (auth).
      await signOut();
    } catch (e) {
      setPending(false);
      toast.show(
        userErrorMessage(e, "Impossibile eliminare l'account. Riprova."),
        "error"
      );
    }
  }

  return (
    <View className="gap-2">
      <SectionHeader title="Zona pericolosa" />
      <Text className="text-[13px] leading-5 text-t3">
        {isOwner
          ? "Eliminando l'account, se sei l'unico titolare l'azienda si chiude e i turni futuri vengono annullati."
          : "Foto e recapiti del profilo vengono rimossi; le schede dell'organico restano alle aziende, scollegate dall'account."}
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
