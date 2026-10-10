/** Annullare la timbratura di un fuori turno toglie il turno: lo si dice prima. */
export const UNPLANNED_VOID_NOTICE =
  "È un turno «Fuori turno»: esiste solo per questa timbratura, quindi annullandola viene tolto anche il turno.";

/**
 * L'uscita scelta con un selettore d'orario per una timbratura senza turno:
 * il primo istante dopo l'entrata che segna quell'ora. Le 02:00 scelte per
 * un'entrata delle 22:00 sono quindi la notte dopo, non la mattina prima.
 *
 * Come `TimeField`, ragiona nell'ora del dispositivo: il selettore cambia solo
 * ore e minuti del `Date` che riceve.
 */
export function unplannedOutAt(clockInAt: string, picked: Date): Date {
  const inAt = new Date(clockInAt);
  const out = new Date(inAt);
  out.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  if (out.getTime() <= inAt.getTime()) out.setDate(out.getDate() + 1);
  return out;
}
