import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export type VenueRole = Tables<"venue_roles">;

/**
 * I ruoli che una sede può assegnare. Li scrive il gestore: "Cameriere" e
 * "Barman" da una parte, "PR" e "Guardaroba" dall'altra — le sedi non si
 * somigliano, e prima la lista era una costante uguale per tutti.
 *
 * Solo i non archiviati: un ruolo eliminato sparisce dalle scelte nuove ma resta
 * attaccato allo storico (turni passati, schede già compilate), quindi non si
 * cancella mai davvero.
 */
export async function getVenueRoles(venueId: string): Promise<VenueRole[]> {
  const { data, error } = await supabase
    .from("venue_roles")
    .select("*")
    .eq("venue_id", venueId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * I ruoli di più sedi insieme, per i filtri dell'azienda (lo storico turni).
 *
 * Include gli archiviati: un filtro sullo storico deve poter nominare un ruolo
 * che oggi non si assegna più ma che quei turni passati avevano. Chi raggruppa
 * per nome (`groupRolesByName`) fonde da sé il ruolo archiviato con quello
 * ancora vivo che si chiama uguale.
 */
export async function getOwnerVenueRoles(
  venueIds: string[]
): Promise<VenueRole[]> {
  if (venueIds.length === 0) return [];
  const { data, error } = await supabase
    .from("venue_roles")
    .select("*")
    .in("venue_id", venueIds)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Nuovo ruolo in coda alla lista. `sort_order` lo calcola il client dal massimo
 * corrente: una sequenza DB darebbe numeri globali, e l'ordine è per sede.
 */
export async function createVenueRole(
  venueId: string,
  name: string
): Promise<VenueRole> {
  const { data: last, error: lastError } = await supabase
    .from("venue_roles")
    .select("sort_order")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) throw new Error(lastError.message);

  const { data, error } = await supabase
    .from("venue_roles")
    .insert({
      venue_id: venueId,
      name: name.trim(),
      sort_order: (last?.[0]?.sort_order ?? 0) + 1,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Rinomina. Non scollega niente: turni e schede puntano all'`id`, non al nome —
 * è il motivo per cui questa tabella esiste al posto delle vecchie stringhe.
 */
export async function renameVenueRole(
  id: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from("venue_roles")
    .update({ name: name.trim() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Fuori dalle scelte future, intatto nello storico. */
export async function archiveVenueRole(id: string): Promise<void> {
  const { error } = await supabase
    .from("venue_roles")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** I ruoli di una persona dell'organico. */
export async function getStaffMemberRoles(
  staffMemberId: string
): Promise<VenueRole[]> {
  const { data, error } = await supabase
    .from("staff_member_roles")
    .select("role:venue_roles(*)")
    .eq("staff_member_id", staffMemberId);
  if (error) throw new Error(error.message);
  const rows = (data as { role: VenueRole | null }[] | null) ?? [];
  return rows
    .map((r) => r.role)
    .filter((r): r is VenueRole => !!r)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Sostituisce per intero i ruoli di una persona: è una lista, non righe
 * indipendenti, e chi chiama ha sempre in mano l'elenco completo.
 */
export async function setStaffMemberRoles(
  staffMemberId: string,
  roleIds: string[]
): Promise<void> {
  const { error: delError } = await supabase
    .from("staff_member_roles")
    .delete()
    .eq("staff_member_id", staffMemberId);
  if (delError) throw new Error(delError.message);

  if (roleIds.length === 0) return;

  const { error } = await supabase
    .from("staff_member_roles")
    .insert(
      roleIds.map((role_id) => ({ staff_member_id: staffMemberId, role_id }))
    );
  if (error) throw new Error(error.message);
}
