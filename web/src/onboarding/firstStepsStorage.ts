import {
  firstStepsKey,
  parseFirstStepsMemory,
  type FirstStepsMemory,
} from "@/features/onboarding/firstSteps";

/**
 * Controparte web di `src/features/onboarding/firstStepsStorage.ts`: stessa
 * chiave, `localStorage` al posto di SecureStore. Tutto in try/catch: in
 * navigazione privata `localStorage` può lanciare, e una preferenza persa costa
 * solo una card in più.
 */
export function loadFirstStepsMemory(userId: string, workspaceId: string): FirstStepsMemory | null {
  try {
    return parseFirstStepsMemory(window.localStorage.getItem(firstStepsKey(userId, workspaceId)));
  } catch {
    return null;
  }
}

export function saveFirstStepsMemory(userId: string, workspaceId: string, value: FirstStepsMemory): void {
  try {
    window.localStorage.setItem(firstStepsKey(userId, workspaceId), value);
  } catch {
    // vedi il commento in testa
  }
}
