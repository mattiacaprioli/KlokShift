import * as SecureStore from "expo-secure-store";
import {
  firstStepsKey,
  parseFirstStepsMemory,
  type FirstStepsMemory,
} from "./firstSteps";

/**
 * Se la checklist «Primi passi» è stata chiusa o finita, su questo telefono.
 *
 * Locale e non sul DB di proposito: la checklist si chiude da sola quando i
 * dati dicono che è tutto fatto, quindi «chiudi» è solo una preferenza. Il
 * prezzo — chiusa qui, la dashboard la mostra ancora — vale meno di una
 * colonna, una migration e una RPC. Controparte web:
 * `web/src/onboarding/firstStepsStorage.ts`.
 */
export async function loadFirstStepsMemory(
  userId: string,
  workspaceId: string
): Promise<FirstStepsMemory | null> {
  try {
    return parseFirstStepsMemory(
      await SecureStore.getItemAsync(firstStepsKey(userId, workspaceId))
    );
  } catch {
    return null;
  }
}

export async function saveFirstStepsMemory(
  userId: string,
  workspaceId: string,
  value: FirstStepsMemory
): Promise<void> {
  try {
    await SecureStore.setItemAsync(firstStepsKey(userId, workspaceId), value);
  } catch {
    // Non ricordarlo costa una card in più al prossimo avvio.
  }
}
