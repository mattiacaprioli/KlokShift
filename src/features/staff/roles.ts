/**
 * Suggerimenti per una sede che non ha ancora creato nessun ruolo.
 *
 * Fino al 2026-09-12 questa era `STAFF_ROLES`, una lista canonica di 15 voci:
 * **la** fonte di verità per l'organico, per il fabbisogno dei turni e per il
 * profilo del professionista. Tutto si teneva per stringa esatta, quindi non si
 * poteva né rinominare né riordinare niente senza scollegare in silenzio la
 * copertura dei turni già creati.
 *
 * Ora i ruoli li scrive il gestore (tabella `venue_roles`, un elenco per
 * sede): un hotel non ha un sommelier, una discoteca ha il PR. Qui resta solo
 * la spinta iniziale — cinque esempi tappabili nell'empty state, scelti per
 * coprire sala, bar, cucina e accoglienza e far capire di che granularità si
 * parla. Non hanno alcun significato per il DB: creano righe come qualunque
 * nome scritto a mano, e possono essere rinominate o archiviate subito dopo.
 */
export const SUGGESTED_ROLES = [
  "Cameriere",
  "Barman",
  "Cuoco",
  "Lavapiatti",
  "Receptionist",
] as const;
