import type { Membership } from "@/features/workspace/types";
import type { ViewMode } from "./viewModeStorage";

/**
 * Cosa ha detto di voler fare alla registrazione. Un'indicazione, non un ruolo.
 * Senza import nativi: la legge anche la dashboard web.
 */
export function signupIntent(
  metadata: Record<string, unknown> | undefined
): ViewMode {
  return metadata?.intent === "manager" ? "manager" : "waiter";
}

/** Calcolo puro della vista dopo che appartenenze e profilo sono noti. */
export function resolvedViewMode({
  canManage,
  canWork,
  onboardingComplete,
  savedMode,
  intent,
}: {
  canManage: boolean;
  canWork: boolean;
  onboardingComplete: boolean;
  savedMode: ViewMode | null | undefined;
  intent: ViewMode;
}): { effective: ViewMode; canSwitch: boolean } {
  // L'onboarding non concede accessi aziendali: dice soltanto che il lato
  // personale dell'account esiste ancora anche se oggi non lavora nel team.
  const hasPersonalView = canWork || onboardingComplete;
  const canSwitch = canManage && hasPersonalView;

  if (canSwitch) {
    return {
      effective: savedMode === "waiter" ? "waiter" : "manager",
      canSwitch,
    };
  }
  if (canManage) return { effective: "manager", canSwitch };
  if (hasPersonalView) return { effective: "waiter", canSwitch };
  return { effective: intent, canSwitch };
}

/**
 * «Passa ai tuoi turni» nel Menu della gestione.
 *
 * Il titolare non ne ha bisogno per la propria azienda: la Home della gestione
 * gli fa già timbrare e confermare i suoi turni («I tuoi turni»), e mettersi
 * in turno da sé vale come conferma. Gli resta solo se lavora **anche in
 * un'altra azienda**, i cui turni stanno solo nella vista lavoro.
 * Il collaboratore lo tiene: ferie, cambi turno e ore sue passano da lì.
 */
export function showSwitchToWork({
  canSwitch,
  isOwner,
  workspaceId,
  memberships,
}: {
  canSwitch: boolean;
  isOwner: boolean;
  workspaceId: string | undefined;
  memberships: readonly Pick<
    Membership,
    "workspace_id" | "status" | "authority" | "works"
  >[];
}): boolean {
  if (!canSwitch) return false;
  if (!isOwner) return true;
  return memberships.some(
    (m) =>
      m.workspace_id !== workspaceId &&
      m.status === "active" &&
      (m.authority === "none" || m.works.length > 0)
  );
}
