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
 * Il logo del locale, scritto da solo.
 *
 * Separato da `saveVenue` perché la foto si carica **prima** di salvare il
 * resto del modulo, e spesso senza toccarlo: farla passare dal form avrebbe
 * significato o salvare campi non ancora compilati, o perdere la foto uscendo
 * senza salvare. Serve un locale già esistente — chi non ce l'ha ancora
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
 * ⚠️ **Niente `.eq("owner_id", …)`, e non è una dimenticanza.** Da quando
 * esistono i collaboratori (`venue_access`), "le mie sedi" non sono più "le sedi
 * di cui sono proprietario": il filtro escluderebbe proprio le sedi delegate.
 * Il perimetro lo fa la RLS — su `venues` esistono due sole policy, "owner crud"
 * e "delegate read", e nessuna delle due è aperta a tutti. Rimettere il filtro
 * qui significa rompere l'accesso dei collaboratori; toglierlo altrove (su
 * `shifts`, per dire) significa il contrario, e lì il filtro va tenuto.
 */
export async function getMyVenues(): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    // I locali chiusi restano consultabili, ma non sono posti in cui si lavora:
    // fuori dallo switcher e fuori da ogni query operativa.
    .is("closed_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** I locali archiviati, per la sezione "Locali chiusi". */
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
