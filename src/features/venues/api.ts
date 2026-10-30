import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export { createFirstVenue, createVenue, setVenueClosed } from "@/features/workspace/api";

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
 * resto del modulo, e spesso senza toccarlo. Serve una sede già esistente.
 *
 * ⚠️ `.select()` non è un capriccio: senza, un update che la RLS non fa passare
 * non tocca nessuna riga e **non dà errore** — PostgREST risponde 204 lo stesso.
 * A chi non ha «Dati della sede» la dashboard direbbe «Logo aggiornato» su una
 * sede rimasta com'era. Ora torna la riga scritta, e zero righe sono un errore.
 */
export async function updateVenueLogo(
  venueId: string,
  logoUrl: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from("venues")
    .update({ logo_url: logoUrl })
    .eq("id", venueId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Non puoi modificare i dati di questa sede.");
}

/**
 * Le sedi **aperte** che si gestiscono, la più vecchia prima.
 *
 * Gli id vengono da `get_my_context` (già filtrati per sede e permesso): questa
 * select serve a leggere le righe intere. La RLS resta il perimetro — le sedi che
 * non si vedono non tornano comunque.
 *
 * Due ordinamenti e non uno: `created_at` decide chi è la sede di default, e `id`
 * è il tie-break perché due sedi create nello stesso istante non devono potersi
 * invertire fra due caricamenti.
 *
 * Regola opposta su `shifts`: lì il filtro `venue_id` è il perimetro e non si
 * toglie mai (vedi `features/shifts/api.ts`).
 */
export async function getMyVenues(
  venueIds: readonly string[]
): Promise<Venue[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .in("id", [...venueIds])
    .is("closed_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Le sedi archiviate di un'azienda, per la sezione "Sedi chiuse". */
export async function getMyClosedVenues(workspaceId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("workspace_id", workspaceId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Modifica i dati di una sede. Le sedi nuove si creano con `createVenue` /
 * `createFirstVenue` (RPC): non c'è più un insert diretto sulla tabella.
 */
export async function updateVenue(
  venueId: string,
  input: VenueInput
): Promise<Venue> {
  const { data, error } = await supabase
    .from("venues")
    .update(input)
    .eq("id", venueId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Non puoi modificare i dati di questa sede.");
  return data;
}

/**
 * Il calendario delle sedi indicate: le chiusure (`venue_closures`) e il
 * riposo settimanale (`venues.rest_days`). Poche righe per sede e per anno: si
 * leggono tutte, e i calendari filtrano per giorno.
 */
export async function getVenueCalendar(venueIds: readonly string[]): Promise<{
  closures: Tables<"venue_closures">[];
  restDays: Record<string, number[]>;
}> {
  if (venueIds.length === 0) return { closures: [], restDays: {} };
  const [closures, venues] = await Promise.all([
    supabase.from("venue_closures").select("*").in("venue_id", [...venueIds]).order("start_date").limit(500),
    supabase.from("venues").select("id, rest_days").in("id", [...venueIds]),
  ]);
  if (closures.error) throw new Error(closures.error.message);
  if (venues.error) throw new Error(venues.error.message);
  return {
    closures: closures.data ?? [],
    restDays: Object.fromEntries((venues.data ?? []).map((v) => [v.id, v.rest_days ?? []])),
  };
}

export async function setVenueRestDays(venueId: string, days: number[]): Promise<void> {
  const { error } = await supabase.rpc("set_venue_rest_days", { p_venue: venueId, p_days: days });
  if (error) throw new Error(error.message);
}

export async function saveVenueClosure(input: {
  venueId: string;
  start: string;
  end: string;
  reason?: string | null;
  repeatYearly?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("save_venue_closure", {
    p_venue: input.venueId,
    p_start: input.start,
    p_end: input.end,
    p_reason: input.reason ?? undefined,
    p_repeat_yearly: input.repeatYearly ?? false,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteVenueClosure(closureId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_venue_closure", { p_closure: closureId });
  if (error) throw new Error(error.message);
}
