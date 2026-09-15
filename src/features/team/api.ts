import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import type { Tables } from "@/types/database";

/**
 * I collaboratori del titolare: chi altro entra nell'account, su quali sedi e
 * con quali permessi.
 *
 * Una riga per **(sede, persona)**. Il titolare non ha righe qui: `venues
 * .owner_id` resta la fonte di verità del "può tutto", e questa tabella non può
 * dare a nessuno più di quello.
 *
 * ⚠️ Nessun import di Expo o di React Native: la dashboard web riusa questo file.
 */
export type VenueAccess = Tables<"venue_access">;

/** Le aree di permesso, nell'ordine in cui compaiono nella UI. */
export const TEAM_PERMISSIONS = [
  "can_manage_shifts",
  "can_manage_staff",
  "can_view_hours",
  "can_manage_documents",
  "can_manage_venue",
] as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export const TEAM_PERMISSION_LABEL: Record<TeamPermission, string> = {
  can_manage_shifts: "Turni",
  can_manage_staff: "Organico",
  can_view_hours: "Ore ed export",
  can_manage_documents: "Documenti",
  can_manage_venue: "Dati della sede",
};

export const TEAM_PERMISSION_HINT: Record<TeamPermission, string> = {
  can_manage_shifts: "Crea, modifica e assegna i turni della sede",
  can_manage_staff: "Aggiunge persone alla sede e assegna le mansioni",
  can_view_hours: "Vede le ore lavorate e scarica gli export",
  can_manage_documents: "Vede e carica HACCP, contratti e scadenze",
  can_manage_venue: "Modifica i dati della sede e l'elenco delle mansioni",
};

export type TeamPermissions = Record<TeamPermission, boolean>;

/**
 * Una persona, con tutte le sedi su cui ha accesso.
 *
 * La UI ragiona per persona ("chi entra nel mio account"), il DB per sede
 * (è lì che serve al momento del controllo): l'aggregazione sta qui, una volta,
 * invece che in ogni schermata.
 */
export type TeamMember = {
  /** L'account, se la persona si è registrata. Altrimenti `null`. */
  userId: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** `pending` finché non c'è un account collegato. */
  status: "pending" | "active" | "revoked";
  /** Le righe `venue_access`, una per sede. */
  rows: VenueAccess[];
  venueIds: string[];
  invitedAt: string | null;
  inviteCount: number;
};

export function permissionsOf(row: VenueAccess): TeamPermissions {
  return {
    can_manage_shifts: row.can_manage_shifts,
    can_manage_staff: row.can_manage_staff,
    can_view_hours: row.can_view_hours,
    can_manage_documents: row.can_manage_documents,
    can_manage_venue: row.can_manage_venue,
  };
}

/**
 * I permessi di una persona **su tutte le sue sedi**: `null` quando divergono,
 * così la UI può dire "dipende dalla sede" invece di mostrare il valore della
 * prima riga come se fosse l'unico.
 *
 * Stessa forma di `personEmploymentType` in `features/staff/api.ts`.
 */
export function memberPermissions(
  member: TeamMember
): Partial<Record<TeamPermission, boolean | null>> {
  const out: Partial<Record<TeamPermission, boolean | null>> = {};
  for (const perm of TEAM_PERMISSIONS) {
    const first = member.rows[0]?.[perm] ?? false;
    out[perm] = member.rows.every((r) => r[perm] === first) ? first : null;
  }
  return out;
}

/** Chiave di raggruppamento: l'account se c'è, altrimenti l'indirizzo. */
function memberKey(row: VenueAccess): string {
  return row.user_id ?? `email:${(row.email ?? "").toLowerCase()}`;
}

/**
 * I collaboratori del titolare, raggruppati per persona.
 *
 * Le righe revocate non tornano: una revoca è una porta chiusa, non uno stato da
 * consultare. Restano in tabella perché `venue_access_notify` ha già avvisato la
 * persona e perché riaprire l'accesso è un `update`, non un nuovo invito.
 */
export async function getTeam(ownerId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("venue_access")
    .select("*")
    .eq("owner_id", ownerId)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];

  // I nomi stanno in `profiles`, non qui: la riga di accesso porta l'indirizzo
  // dell'invito, che dopo la registrazione può non essere più come si chiama.
  const names = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds);
    if (profErr) throw new Error(profErr.message);
    for (const p of profiles ?? []) {
      names.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
    }
  }

  const byKey = new Map<string, TeamMember>();
  for (const row of rows) {
    const key = memberKey(row);
    const found = byKey.get(key);
    if (found) {
      found.rows.push(row);
      found.venueIds.push(row.venue_id);
      // Il più recente dei due: è quello che decide se il pulsante "Reinvia" è
      // ancora bloccato dal rate limit.
      if (row.invited_at && (!found.invitedAt || row.invited_at > found.invitedAt)) {
        found.invitedAt = row.invited_at;
      }
      found.inviteCount = Math.max(found.inviteCount, row.invite_count);
      continue;
    }
    const profile = row.user_id ? names.get(row.user_id) : undefined;
    byKey.set(key, {
      userId: row.user_id,
      email: row.email,
      fullName: profile?.full_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      status: row.user_id ? "active" : "pending",
      rows: [row],
      venueIds: [row.venue_id],
      invitedAt: row.invited_at,
      inviteCount: row.invite_count,
    });
  }
  return [...byKey.values()];
}

/**
 * I **miei** accessi delegati. Vuoto per il titolare, che non ha righe qui.
 *
 * La RLS fa già il filtro (`user_id = auth.uid()`); il `.eq` esplicito c'è
 * perché una query senza `where` su una tabella che cresce con l'azienda è il
 * tipo di select che diventa un full scan quando le policy cambiano.
 */
export async function getMyVenueAccess(userId: string): Promise<VenueAccess[]> {
  const { data, error } = await supabase
    .from("venue_access")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Un gestore già registrato, cercato per indirizzo. `null` se non esiste. */
export async function findManagerByEmail(
  email: string
): Promise<{ id: string; full_name: string | null; avatar_url: string | null } | null> {
  const { data, error } = await supabase.rpc("find_manager_by_email", {
    p_email: email,
  });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export type AddTeamMemberInput = {
  ownerId: string;
  email: string;
  venueIds: string[];
  permissions: TeamPermissions;
};

export type AddTeamMemberResult =
  /** La persona aveva già un account: l'accesso è attivo da subito. */
  | { kind: "linked"; name: string | null }
  /** Nessun account: riga in attesa e invito spedito (o no, se l'SMTP ha detto no). */
  | { kind: "invited"; emailSent: boolean }
  /** Ha già accesso a quelle sedi. */
  | { kind: "already" };

/**
 * Aggiunge un collaboratore.
 *
 * Un solo punto d'ingresso con dentro la decisione, invece di due modalità da
 * scegliere a mano: chi invita non sa — e non deve sapere — se la persona ha già
 * un account topWaitr. È la stessa forma di `addStaff()` per l'organico.
 */
export async function addTeamMember(
  input: AddTeamMemberInput
): Promise<AddTeamMemberResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await findManagerByEmail(email);

  const rows = input.venueIds.map((venueId) => ({
    venue_id: venueId,
    owner_id: input.ownerId,
    user_id: existing?.id ?? null,
    email,
    status: existing ? "active" : "pending",
    ...input.permissions,
  }));

  const { error } = await supabase.from("venue_access").insert(rows);
  if (error) {
    // Le due unique (per account e per indirizzo) dicono la stessa cosa: quella
    // persona su quella sede c'è già.
    if (error.code === "23505") return { kind: "already" };
    throw teamError(error.message);
  }

  if (existing) return { kind: "linked", name: existing.full_name };

  // L'invito si manda a una riga sola: l'email nomina una sede, e cinque email
  // per cinque sedi sono cinque email. Si sceglie la prima, che è anche quella
  // che il titolare ha spuntato per prima.
  const { data: created } = await supabase
    .from("venue_access")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1);

  const accessId = created?.[0]?.id;
  if (!accessId) return { kind: "invited", emailSent: false };

  try {
    await sendTeamInvite(accessId);
    return { kind: "invited", emailSent: true };
  } catch {
    // L'accesso è stato creato: se l'email non parte, il titolare ha comunque
    // una riga in lista e un pulsante "Reinvia". Fallire tutto qui vorrebbe dire
    // buttare via un invito già valido perché l'SMTP era occupato.
    return { kind: "invited", emailSent: false };
  }
}

/**
 * I messaggi dei vincoli DB, tradotti.
 *
 * ⚠️ `UserFacingError` e non `Error`: `userErrorMessage()` generalizza qualunque
 * messaggio non marcato, e queste frasi sono scritte per essere lette così come
 * sono (vedi src/lib/errors.ts).
 */
function teamError(message: string): Error {
  if (message.includes("already_in_other_company")) {
    return new UserFacingError(
      "Questa persona collabora già con un altro locale su topWaitr."
    );
  }
  if (message.includes("already_owns_venues")) {
    return new UserFacingError("Questa persona ha già un locale suo su topWaitr.");
  }
  return new Error(message);
}

/**
 * Cambia i permessi di una persona su una sede sola.
 *
 * Per sede e non per persona di proposito: chi gestisce due sedi può avere due
 * mestieri diversi, e un'unica scrittura "su tutte le sedi" cancellerebbe la
 * differenza senza dirlo.
 */
export async function updateTeamPermissions(
  accessId: string,
  permissions: Partial<TeamPermissions>
): Promise<void> {
  const { error } = await supabase
    .from("venue_access")
    .update(permissions)
    .eq("id", accessId);
  if (error) throw new Error(error.message);
}

/** Aggiunge una sede a un collaboratore che già c'è. */
export async function addTeamVenue(
  ownerId: string,
  member: TeamMember,
  venueId: string,
  permissions: TeamPermissions
): Promise<void> {
  const { error } = await supabase.from("venue_access").insert({
    venue_id: venueId,
    owner_id: ownerId,
    user_id: member.userId,
    email: member.email,
    status: member.userId ? "active" : "pending",
    ...permissions,
  });
  if (error) throw teamError(error.message);
}

/**
 * Revoca l'accesso, su una sede o su tutte.
 *
 * `status = 'revoked'` e non una delete: è il passaggio che fa scattare la
 * notifica `team_removed`. Togliere l'accesso in silenzio a chi ieri organizzava
 * i turni non è una cosa che si fa senza dirlo.
 */
export async function revokeTeamAccess(accessIds: string[]): Promise<void> {
  if (accessIds.length === 0) return;
  const { error } = await supabase
    .from("venue_access")
    .update({ status: "revoked" })
    .in("id", accessIds);
  if (error) throw new Error(error.message);
}

/**
 * Rimanda l'email d'invito.
 *
 * Il body porta solo l'id della riga, mai un indirizzo: per spedire a qualcuno
 * bisogna prima averlo scritto su un proprio accesso, dove l'unique e
 * `invite_count` lo tengono sotto controllo. Stessa scelta di `sendStaffInvite`.
 */
export async function sendTeamInvite(accessId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ error?: string }>(
    "invite-staff",
    { body: { kind: "team", accessId } }
  );
  if (!error) return;

  // `functions.invoke` non mette il corpo della risposta dentro `error` sui
  // 4xx/5xx: il codice vero sta in `data`, ed è l'unico modo per distinguere
  // "riprova tra un po'" da "riprova adesso".
  const code = `${data?.error ?? ""} ${error.message ?? ""}`;

  if (code.includes("rate_limited")) {
    throw new UserFacingError(
      "Invito già mandato da poco. Potrai rimandarlo tra un quarto d'ora."
    );
  }
  if (code.includes("already_linked")) {
    throw new UserFacingError("Questa persona ha già un account collegato.");
  }
  if (code.includes("no_email")) {
    throw new UserFacingError("Questo accesso non ha un'email.");
  }
  if (code.includes("NOT_FOUND")) {
    // La Edge Function non è deployata: nessun workflow la pubblica, va fatto
    // a mano con `supabase functions deploy invite-staff`.
    throw new UserFacingError(
      "Gli inviti via email non sono ancora attivi su questo progetto."
    );
  }
  throw new UserFacingError(
    "Non siamo riusciti a mandare l'invito. Riprova tra qualche minuto."
  );
}
