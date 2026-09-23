import * as SecureStore from "expo-secure-store";

/**
 * Con quale cappello una persona con accesso sia alla gestione sia al lavoro ha
 * aperto l'app l'ultima volta.
 *
 * Il cappello non è un ruolo persistito: `useViewMode()` lo ricava dalle
 * appartenenze restituite da `get_my_context()`. Questa preferenza ricorda quale
 * delle due viste valide mostrare all'avvio.
 *
 * Non è un permesso e non ne concede nessuno: authority, permessi e organico
 * restano quelli delle appartenenze correnti. È una comodità, come
 * `lastVenueStorage`, e per la stessa ragione sta in `expo-secure-store`.
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
