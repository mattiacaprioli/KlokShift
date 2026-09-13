import * as SecureStore from "expo-secure-store";

/**
 * Quale sede il titolare stava guardando l'ultima volta.
 *
 * `expo-secure-store` e non AsyncStorage: è già una dipendenza (la usa
 * `src/lib/supabase.ts` per la sessione) e non vale aggiungere un pacchetto per
 * salvare 36 byte. Qui dentro non c'è niente di segreto — è solo il posto dove
 * questo progetto tiene le preferenze che devono sopravvivere al riavvio.
 *
 * ⚠️ La dashboard web usa `web/src/lib/activeVenueStorage.ts`, sostituito da un
 * alias di Vite: le due firme devono restare identiche.
 *
 * La chiave è per **account**: su un telefono condiviso due titolari non si
 * scambiano la sede, e chi cambia account non si ritrova in un locale che non è
 * suo (cosa che poi il provider correggerebbe, ma dopo un lampo di dati sbagliati).
 */
const key = (ownerId: string) => `activeVenue.${ownerId}`;

export async function loadActiveVenueId(
  ownerId: string
): Promise<string | null> {
  if (!ownerId) return null;
  try {
    return await SecureStore.getItemAsync(key(ownerId));
  } catch {
    // Una preferenza illeggibile non è un errore da mostrare: si riparte dalla
    // sede più vecchia, che è il default comunque.
    return null;
  }
}

export async function saveActiveVenueId(
  ownerId: string,
  venueId: string | null
): Promise<void> {
  if (!ownerId) return;
  try {
    if (venueId === null) await SecureStore.deleteItemAsync(key(ownerId));
    else await SecureStore.setItemAsync(key(ownerId), venueId);
  } catch {
    // Non riuscire a ricordare la sede è un fastidio al prossimo avvio, non un
    // motivo per far fallire il cambio di sede che l'utente ha appena fatto.
  }
}
