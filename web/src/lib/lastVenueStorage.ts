/**
 * Controparte web di `src/features/venues/lastVenueStorage.ts`, sostituita da un
 * alias in `web/vite.config.mts` — stesso trucco di `@/lib/supabase` e
 * `@/features/push/api`. Le due firme devono restare identiche.
 *
 * ⚠️ La stringa della chiave resta `topwaitr.activeVenue.` di proposito: vedi la
 * spiegazione in testa alla controparte mobile.
 *
 * Tutto in try/catch: in Safari in navigazione privata `localStorage` esiste ma
 * lancia in scrittura, e non ricordare la sede non deve impedire di sceglierla.
 */
const key = (ownerId: string) => `topwaitr.activeVenue.${ownerId}`;

export async function loadLastVenueId(ownerId: string): Promise<string | null> {
  if (!ownerId) return null;
  try {
    return window.localStorage.getItem(key(ownerId));
  } catch {
    return null;
  }
}

export async function saveLastVenueId(
  ownerId: string,
  venueId: string | null
): Promise<void> {
  if (!ownerId) return;
  try {
    if (venueId === null) window.localStorage.removeItem(key(ownerId));
    else window.localStorage.setItem(key(ownerId), venueId);
  } catch {
    // vedi il commento in testa
  }
}
