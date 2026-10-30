import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/features/team/ViewMode";
import { useCompleteOnboarding } from "./hooks";

/**
 * «Passa ai tuoi turni» per chi gestisce e lavora.
 *
 * Il wizard del dipendente chiede solo il nome: un titolare che si è messo
 * nel team ce l'ha già, e passando alla vista lavoro si sarebbe trovato
 * davanti un «Come ti vedrà la tua sede» senza motivo. Se il nome c'è,
 * l'onboarding si chiude qui in silenzio; se manca (o il salvataggio fallisce)
 * il wizard resta la rete, com'era prima.
 */
export function useSwitchToWorkView() {
  const { session, profile, refreshProfile } = useAuth();
  const { setMode } = useViewMode();
  const complete = useCompleteOnboarding(session?.user.id ?? "");
  const [busy, setBusy] = useState(false);

  async function switchToWork() {
    const name = profile?.full_name?.trim();
    if (session && profile && !profile.onboarding_complete && name) {
      setBusy(true);
      try {
        await complete.mutateAsync({ full_name: name });
        await refreshProfile();
      } catch {
        // Si passa lo stesso: il wizard chiederà il nome.
      } finally {
        setBusy(false);
      }
    }
    setMode("waiter");
  }

  return { switchToWork, busy };
}
