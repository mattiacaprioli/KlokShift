/**
 * Controparte web di `src/features/venues/activeVenueStorage.ts`, sostituita da
 * un alias in `web/vite.config.mts` — stesso trucco di `@/lib/supabase` e
 * `@/features/push/api`. Le due firme devono restare identiche.
 *
 * Tutto in try/catch: in Safari in navigazione privata `localStorage` esiste ma
 * lancia in scrittura, e non ricordare la sede non deve impedire di cambiarla.
 */
const key = (ownerId: string) => `topwaitr.activeVenue.${ownerId}`;

export async function loadActiveVenueId(
  ownerId: string
): Promise<string | null> {
  if (!ownerId) return null;
  try {
    return window.localStorage.getItem(key(ownerId));
  } catch {
    return null;
  }
}

export async function saveActiveVenueId(
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
