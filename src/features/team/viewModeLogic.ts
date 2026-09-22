import type { ViewMode } from "./viewModeStorage";

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
  // personale dell'account esiste ancora anche se oggi non lavora in organico.
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
