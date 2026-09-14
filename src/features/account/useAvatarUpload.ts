import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { qk } from "@/lib/queryKeys";
import { useToast } from "@/providers/Toast";
import { deleteAvatarByUrl, updateMyProfile, uploadAvatar } from "./api";
import { pickAvatar } from "./avatarPicker";

/**
 * La foto profilo di chi è loggato: scegliere, caricare, togliere.
 *
 * Vale per tutti i ruoli — il professionista dalla sua scheda, il gestore dal
 * suo account — perché è lo stesso gesto sullo stesso bucket. Stava scritto due
 * volte nelle due schermate, ed era il modo più veloce per far divergere
 * l'ordine delle operazioni, che è l'unica parte delicata:
 *
 * ⚠️ **Prima il profilo punta alla foto nuova, poi si cancella la vecchia.**
 * Al contrario, un errore a metà lascia `avatar_url` a puntare a un file che
 * non esiste più — e l'utente si ritrova senza foto senza aver chiesto niente.
 */
export function useAvatarUpload(userId: string) {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /** Il ritaglio quadrato e il ridimensionamento li fa `pickAvatar`. */
  async function pick() {
    if (busy) return;
    const previous = profile?.avatar_url ?? null;
    try {
      const picked = await pickAvatar();
      if (!picked) return; // annullato
      setBusy(true);
      const url = await uploadAvatar(userId, picked.bytes, {
        contentType: picked.contentType,
      });
      await updateMyProfile(userId, { avatar_url: url });
      await deleteAvatarByUrl(previous);
      await refreshProfile();
      qc.invalidateQueries({ queryKey: qk.profile.mine(userId) });
      toast.show("Foto aggiornata");
    } catch (e) {
      toast.show(userErrorMessage(e, "Caricamento non riuscito"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const previous = profile?.avatar_url ?? null;
    if (!previous || busy) return;
    setBusy(true);
    try {
      await updateMyProfile(userId, { avatar_url: null });
      await deleteAvatarByUrl(previous);
      await refreshProfile();
      qc.invalidateQueries({ queryKey: qk.profile.mine(userId) });
      toast.show("Foto rimossa");
    } catch (e) {
      toast.show(userErrorMessage(e, "Operazione non riuscita"), "error");
    } finally {
      setBusy(false);
    }
  }

  return { uri: profile?.avatar_url ?? null, busy, pick, remove };
}
