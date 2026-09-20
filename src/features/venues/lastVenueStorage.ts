import * as SecureStore from "expo-secure-store";

/**
 * L'ultima sede che il titolare ha usato **in un form**.
 *
 * Fino al 14/09/2026 questa era la "sede attiva": il perimetro di ogni schermata
 * del gestore. Oggi le schermate guardano tutte le sedi insieme, e questa
 * preferenza serve a una cosa sola e molto più piccola: proporre una sede
 * sensata dove una sede va scelta per forza — il form turno e la schermata dei
 * ruoli. Chi sta lavorando su Milano ci resta, senza che Milano diventi un
 * modo di vedere l'app.
 *
 * `expo-secure-store` e non AsyncStorage: è già una dipendenza (la usa
 * `src/lib/supabase.ts` per la sessione) e non vale aggiungere un pacchetto per
 * salvare 36 byte. Qui dentro non c'è niente di segreto — è solo il posto dove
 * questo progetto tiene le preferenze che devono sopravvivere al riavvio.
 *
 * ⚠️ La dashboard web usa `web/src/lib/lastVenueStorage.ts`, sostituito da un
 * alias di Vite: le due firme devono restare identiche.
 *
 * La chiave è per **account**: su un telefono condiviso due titolari non si
 * scambiano la sede, e chi cambia account non si ritrova una sede che non è suo.
 *
 * ⚠️ La stringa della chiave resta `activeVenue.` di proposito: così al primo
 * avvio dopo l'aggiornamento il form turno propone la sede che l'utente aveva
 * attiva prima del refactor, invece di ripartire dalla più vecchia.
 */
const key = (workspaceId: string) => `activeVenue.${workspaceId}`;

export async function loadLastVenueId(
  workspaceId: string
): Promise<string | null> {
  if (!workspaceId) return null;
  try {
    return await SecureStore.getItemAsync(key(workspaceId));
  } catch {
    // Una preferenza illeggibile non è un errore da mostrare: si riparte dalla
    // sede più vecchia, che è il default comunque.
    return null;
  }
}

export async function saveLastVenueId(
  workspaceId: string,
  venueId: string | null
): Promise<void> {
  if (!workspaceId) return;
  try {
    if (venueId === null) await SecureStore.deleteItemAsync(key(workspaceId));
    else await SecureStore.setItemAsync(key(workspaceId), venueId);
  } catch {
    // Non riuscire a ricordare la sede è un fastidio al prossimo avvio, non un
    // motivo per far fallire il salvataggio che l'utente ha appena fatto.
  }
}
