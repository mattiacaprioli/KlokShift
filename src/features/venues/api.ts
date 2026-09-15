import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export type Venue = Tables<"venues">;

export type VenueInput = {
  name: string;
  city: string | null;
  address: string | null;
  cuisine_type: string | null;
  description: string | null;
};

/**
 * Il logo della sede, scritto da solo.
 *
 * Separato da `saveVenue` perché la foto si carica **prima** di salvare il
 * resto del modulo, e spesso senza toccarlo: farla passare dal form avrebbe
 * significato o salvare campi non ancora compilati, o perdere la foto uscendo
 * senza salvare. Serve una sede già esistente — chi non ce l'ha ancora
 * compila prima il nome.
 */
export async function updateVenueLogo(
  venueId: string,
  logoUrl: string | null
): Promise<void> {
  const { error } = await supabase
    .from("venues")
    .update({ logo_url: logoUrl })
    .eq("id", venueId);
  if (error) throw new Error(error.message);
}

/** Un uuid e nient'altro: vedi `getMyVenues`. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tutte le sedi **aperte** a cui si ha accesso, la più vecchia prima.
 *
 * Sostituisce il vecchio `getMyVenue`, che faceva `.limit(1).maybeSingle()` e
 * scartava in silenzio le altre sedi: un hotel o un catering con più sedi — il
 * pubblico per cui esiste la dashboard — ne vedeva una sola.
 *
 * Due ordinamenti e non uno: `created_at` decide chi è la sede di default, e `id`
 * è il tie-break perché due sedi create nello stesso istante non devono poter
 * invertirsi tra due caricamenti (la sede attiva ballerebbe da sola).
 *
 * ⚠️ **`.eq("owner_id", …)` da solo non basta e non va rimesso.** Da quando
 * esistono i collaboratori (`venue_access`), "le mie sedi" non sono più "le sedi
 * di cui sono proprietario": quel filtro escluderebbe proprio le sedi delegate.
 * Il filtro giusto è la coppia — le mie **oppure** quelle su cui mi hanno dato
 * accesso — ed è quello che questa funzione fa.
 *
 * ⚠️ **E non è il perimetro: è la seconda serratura.** Il perimetro resta la
 * RLS. Questo filtro c'è perché il 2026-09-15 la RLS su `venues` aveva una
 * policy di troppo — `venues: public read`, `using (true)`, residuo del
 * marketplace che nessuna migration aveva mai droppato (20260916150000) — e
 * questa funzione, che era una `select *` nuda, restituiva a ogni account
 * appena creato i locali di tutti. Una policy sbagliata non deve poter
 * diventare da sola una fuga di dati.
 *
 * Regola opposta su `shifts`: lì il filtro `venue_id` è il perimetro e non si
 * toglie mai (vedi `features/shifts/api.ts`).
 */
export async function getMyVenues(
  /** L'utente in sessione: le sedi di cui è proprietario. */
  userId: string,
  /** Le sedi su cui ha un accesso delegato attivo, da `venue_access`. */
  accessVenueIds: readonly string[] = []
): Promise<Venue[]> {
  // ⚠️ Gli id finiscono dentro la sintassi dei filtri PostgREST, dove una
  // virgola o una parentesi cambiano il significato della query. Arrivano da una
  // nostra select, non dall'utente, ma si validano lo stesso: è il posto in cui
  // un giorno qualcuno passerà una stringa presa da altrove.
  if (!UUID_RE.test(userId)) return [];
  const delegated = accessVenueIds.filter((id) => UUID_RE.test(id));

  let query = supabase
    .from("venues")
    .select("*")
    // Le sedi chiuse restano consultabili, ma non sono posti in cui si lavora:
    // fuori dallo switcher e fuori da ogni query operativa.
    .is("closed_at", null);

  query =
    delegated.length > 0
      ? query.or(`owner_id.eq.${userId},id.in.(${delegated.join(",")})`)
      : query.eq("owner_id", userId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}


/** Le sedi archiviate, per la sezione "Sedi chiuse". */
export async function getMyClosedVenues(ownerId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("owner_id", ownerId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Archivia (o riapre) una sede.
 *
 * **Chiudere e non eliminare**, di proposito: un `delete` su `venues` cascata su
 * `shifts`, `staff_members`, `shift_assignments`, `venue_roles` e — via il trigger
 * degli orfani — sui documenti delle persone rimaste senza sedi. Si distruggerebbe
 * lo storico di ore di altre persone per chiudere un ristorante. Chiudere lo
 * toglie dalla circolazione e lo lascia consultabile.
 */
export async function setVenueClosed(
  venueId: string,
  closed: boolean
): Promise<void> {
  const { error } = await supabase
    .from("venues")
    .update({ closed_at: closed ? new Date().toISOString() : null })
    .eq("id", venueId);
  if (error) throw new Error(error.message);
}

export async function saveVenue(
  ownerId: string,
  input: VenueInput,
  venueId?: string
): Promise<Venue> {
  if (venueId) {
    const { data, error } = await supabase
      .from("venues")
      .update(input)
      .eq("id", venueId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from("venues")
    .insert({ ...input, owner_id: ownerId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
