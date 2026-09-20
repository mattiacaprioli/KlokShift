import { supabase } from "@/lib/supabase";
import type { MyContext } from "./types";

/**
 * Il contesto dell'account: le sue appartenenze (anche quelle da accettare), le
 * sedi che gestisce con i permessi e quelle in cui lavora. Una chiamata sola.
 */
export async function getMyContext(): Promise<MyContext> {
  const { data, error } = await supabase.rpc("get_my_context");
  if (error) throw new Error(error.message);
  return data as unknown as MyContext;
}

/**
 * L'interruttore della chat fra colleghi, dell'azienda.
 *
 * Non sta in `get_my_context()` perché lo legge una sola schermata: le
 * impostazioni. Il `select` lo può fare ogni membro (policy «workspaces: members
 * read») — serve anche a chi non gestisce per sapere perché la rubrica è corta.
 */
export async function getStaffCanChat(workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("staff_can_chat")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.staff_can_chat ?? true;
}

/** Solo il titolare: la policy scarta la riga a tutti gli altri. */
export async function setStaffCanChat(
  workspaceId: string,
  enabled: boolean
): Promise<void> {
  // ⚠️ Un update che la RLS scarta torna senza errore: `.select()` e zero righe
  // sono un rifiuto, non un successo.
  const { data, error } = await supabase
    .from("workspaces")
    .update({ staff_can_chat: enabled })
    .eq("id", workspaceId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("owner_only");
}

/** Apre un'azienda: chi la apre ne è il titolare. */
export async function createWorkspace(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_workspace", { p_name: name });
  if (error) throw new Error(error.message);
  return data;
}

export type NewVenueInput = {
  name: string;
  city?: string | null;
  address?: string | null;
  cuisine_type?: string | null;
  description?: string | null;
  logo_url?: string | null;
};

export async function createVenue(
  workspaceId: string,
  input: NewVenueInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_venue", {
    p_workspace: workspaceId,
    p_name: input.name,
    p_address: input.address ?? undefined,
    p_city: input.city ?? undefined,
    p_cuisine_type: input.cuisine_type ?? undefined,
    p_logo_url: input.logo_url ?? undefined,
    p_description: input.description ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * La prima sede di chi non ha ancora un'azienda: apre l'azienda (col nome della
 * sede) e poi la sede. Le due chiamate non sono atomiche, ma la seconda può
 * fallire solo per un nome vuoto — già escluso dal form — e chi riprova ritrova
 * l'azienda appena creata invece di aprirne una seconda.
 */
export async function createFirstVenue(input: NewVenueInput): Promise<{
  workspaceId: string;
  venueId: string;
}> {
  const workspaceId = await createWorkspace(input.name);
  const venueId = await createVenue(workspaceId, input);
  return { workspaceId, venueId };
}

export async function setVenueClosed(
  venueId: string,
  closed: boolean
): Promise<void> {
  const { error } = await supabase.rpc("set_venue_closed", {
    p_venue: venueId,
    p_closed: closed,
  });
  if (error) throw new Error(error.message);
}

export async function transferOwnership(
  workspaceId: string,
  memberId: string
): Promise<void> {
  const { error } = await supabase.rpc("transfer_ownership", {
    p_workspace: workspaceId,
    p_member: memberId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Accetta o rifiuta un invito ricevuto (`status = 'invited'`). Accettare è il
 * consenso: senza, l'azienda non vede né i turni né i dati di chi è stato solo
 * scritto su una scheda.
 */
export async function respondToInvite(
  memberId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_invite", {
    p_member: memberId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
}

/** Rete di sicurezza a ogni accesso: aggancia le schede in attesa di questa email. */
export async function claimInvites(): Promise<number> {
  const { data, error } = await supabase.rpc("claim_invites");
  if (error) throw new Error(error.message);
  return data ?? 0;
}
