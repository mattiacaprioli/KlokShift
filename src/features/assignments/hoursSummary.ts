// Il riepilogo ore, dalla riga della RPC alla persona.
//
// Modulo **puro**: nessun import di Supabase, Expo o React Native. È qui e non in
// `api.ts` perché lo importa anche `src/lib/exportBuilders.ts`, che si vanta di
// essere puro — oggi regge solo perché quel `import type` sparisce a compile time,
// ed è una dipendenza fragile da cui è meglio uscire.

/** Una riga di `get_owner_hours_summary`: quel che una persona ha fatto in UNA sede. */
export type OwnerHoursRow = {
  person_id: string;
  person_name: string;
  venue_id: string;
  venue_name: string;
  /** La sede è chiusa: le sue ore contano comunque, ma la UI deve dirlo. */
  venue_closed: boolean;
  /** Le mansioni **in quella sede**, già composte dal DB ("Cameriere, Barman"). */
  roles: string | null;
  shifts_count: number;
  hours: number;
};

/**
 * La persona con le sue ore del mese: è il livello della busta paga.
 *
 * `hours` è il totale su tutte le sedi del titolare — 20 ore a Roma più 20 a
 * Milano sono 40 ore e un solo cedolino.
 */
export type PersonHours = {
  person_id: string;
  person_name: string;
  /**
   * Le mansioni distinte fra le sue sedi, unite ("Cameriere, Barman". È l'unico
   * valore onesto a livello persona: i ruoli vivono in `venue_roles`, che sono
   * per sede, quindi nessuno è "Barman in azienda".
   */
  roles: string | null;
  shifts_count: number;
  hours: number;
  /**
   * ⚠️ **Interno: non si mostra.** Le righe per sede da cui il totale è
   * composto, tenute perché servono a `mergeRoles`. Dal 14/09/2026 né la pagina
   * Ore né l'export dicono più *dove* sono state fatte le ore: la busta paga è
   * una, e quello è il numero che conta. Rimetterle in pagina è tornare
   * indietro, non aggiungere un dettaglio.
   */
  venues: OwnerHoursRow[];
};

/**
 * Raggruppa **scorrendo**, senza riordinare.
 *
 * `get_owner_hours_summary` ordina già per ore totali della persona decrescenti e
 * poi per nome della sede, quindi le righe di una stessa persona arrivano
 * adiacenti (verificato: il tiebreak su `person_name` lo garantisce anche a parità
 * di totale). Se riordinasse il client, la pagina e il file esportato finirebbero
 * per mostrare due ordini diversi dello stesso mese.
 */
export function groupHoursByPerson(rows: OwnerHoursRow[]): PersonHours[] {
  const out: PersonHours[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.person_id === row.person_id) {
      last.shifts_count += row.shifts_count;
      last.hours += row.hours;
      last.venues.push(row);
      continue;
    }
    out.push({
      person_id: row.person_id,
      person_name: row.person_name,
      roles: null, // composto in coda: serve l'elenco completo delle sedi
      shifts_count: row.shifts_count,
      hours: row.hours,
      venues: [row],
    });
  }
  for (const person of out) person.roles = mergeRoles(person.venues);
  return out;
}

/** Le mansioni distinte fra le sedi, nell'ordine in cui compaiono. */
function mergeRoles(venues: OwnerHoursRow[]): string | null {
  const seen = new Set<string>();
  for (const v of venues) {
    for (const name of (v.roles ?? "").split(",")) {
      const trimmed = name.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return seen.size > 0 ? [...seen].join(", ") : null;
}

