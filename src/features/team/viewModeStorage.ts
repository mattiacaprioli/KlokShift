import * as SecureStore from "expo-secure-store";

/**
 * Con quale cappello un professionista promosso ha aperto l'app l'ultima volta.
 *
 * Esiste solo per la F3: un membro dell'organico a cui il titolare ha dato la
 * gestione resta `profiles.role = 'waiter'` (cambiarlo gli porterebbe via turni,
 * card pubblica e recensioni), quindi il ruolo non può più decidere da solo
 * dove mandarlo all'avvio. Lo decide questa preferenza.
 *
 * Non è un permesso e non ne concede nessuno: chi non ha righe `venue_access`
 * attive resta nella sua app qualunque cosa ci sia scritto qui. È una comodità,
 * come `lastVenueStorage` — e per la stessa ragione sta in `expo-secure-store`,
 * che è già una dipendenza.
 *
 * Chiave per account: su un telefono condiviso due persone non si scambiano la
 * vista.
 *
 * ⚠️ Solo mobile. La dashboard web non ha un lato professionista: chi ha un
 * accesso delegato entra e basta (`web/src/App.tsx`), quindi nessun alias Vite
 * da tenere allineato — a differenza di `lastVenueStorage`.
 */
export type ViewMode = "waiter" | "manager";

const key = (userId: string) => `viewMode.${userId}`;

export async function loadViewMode(userId: string): Promise<ViewMode | null> {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(key(userId));
    return raw === "manager" || raw === "waiter" ? raw : null;
  } catch {
    // Illeggibile: si riparte dal lato professionista, che è la sua identità.
    return null;
  }
}

export async function saveViewMode(
  userId: string,
  mode: ViewMode
): Promise<void> {
  if (!userId) return;
  try {
    await SecureStore.setItemAsync(key(userId), mode);
  } catch {
    // Non ricordare la vista costa un tocco al prossimo avvio.
  }
}
