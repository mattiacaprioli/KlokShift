import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import type { Json } from "@/types/database";
import type { Authority, VenueScope } from "@/features/workspace/types";
import { sendStaffInvite } from "@/features/staff/api";
import {
  fromTeamPermissions,
  NO_PERMISSIONS,
  PERM_OF,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  TEAM_PERMISSIONS,
  toTeamPermissions,
  type Perm,
  type TeamPermission,
  type TeamPermissions,
} from "@/features/workspace/permissions";

/**
 * I collaboratori dell'azienda: chi altro entra nella gestione, cosa può fare e
 * su quali sedi.
 *
 * Dal 20/09/2026 il collaboratore è un `workspace_members` con
 * `authority = 'collaborator'`: permessi e ambito stanno **sul membro**, non più
 * per sede (`venue_access` non esiste più). L'ambito è `all` (tutte le sedi,
 * anche quelle future) o `selected` (l'elenco in `member_scope`).
 *
 * ⚠️ Nessun import di Expo o di React Native: la dashboard web riusa questo file.
 */
export {
  NO_PERMISSIONS,
  PERM_OF,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  TEAM_PERMISSIONS,
  fromTeamPermissions,
  toTeamPermissions,
};
export type { Perm, TeamPermission, TeamPermissions };

export type TeamMember = {
  /** `workspace_members.id`. */
  memberId: string;
  /** L'account, se la persona si è registrata. Altrimenti `null`. */
  userId: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** `pending` finché non ha accettato l'invito a collaborare. */
  status: "pending" | "active" | "revoked";
  permissions: TeamPermissions;
  scope: VenueScope;
  /** Le sedi dell'ambito, solo quando `scope === "selected"`. */
  venueIds: string[];
  invitedAt: string | null;
  inviteCount: number;
};

const TEAM_SELECT: string =
  "id, user_id, email, display_name, status, authority, scope, " +
  "can_shifts, can_staff, can_hours, can_documents, can_venue, " +
  "waiter:profiles!workspace_members_user_id_fkey(id, full_name, avatar_url), " +
  "member_scope(venue_id)";

type RawTeamRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  status: "invited" | "active" | "left";
  authority: Authority;
  scope: VenueScope;
  can_shifts: boolean;
  can_staff: boolean;
  can_hours: boolean;
  can_documents: boolean;
  can_venue: boolean;
  waiter: { id: string; full_name: string | null; avatar_url: string | null } | null;
  member_scope: { venue_id: string }[];
};

function toTeamMember(row: RawTeamRow): TeamMember {
  return {
    memberId: row.id,
    userId: row.user_id,
    email: row.email,
    // Dentro l'azienda vince la scheda, non il profilo (vedi AGENTS.md, «La chat»).
    fullName: row.display_name,
    avatarUrl: row.waiter?.avatar_url ?? null,
    status: row.status === "active" ? "active" : "pending",
    permissions: toTeamPermissions({
      shifts: row.can_shifts,
      staff: row.can_staff,
      hours: row.can_hours,
      documents: row.can_documents,
      venue: row.can_venue,
    }),
    scope: row.scope,
    venueIds: row.member_scope.map((s) => s.venue_id),
    // ⚠️ `member_invites` non ha nessun accesso da REST (contiene l'hash del
    // token): l'ultimo invio non è leggibile dal client.
    invitedAt: null,
    inviteCount: 0,
  };
}

/**
 * I collaboratori dell'azienda. Chi ha perso l'accesso (`set_member_access` con
 * `authority: 'none'`) non torna: quella riga è ridiventata una persona senza
 * poteri di gestione, non compare più qui.
 */
export async function getTeam(workspaceId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(TEAM_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("authority", "collaborator")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as RawTeamRow[] | null) ?? [];
  return rows.map(toTeamMember);
}

/** Come `TeamMember`, ma con `authority`: serve a sapere se è già un collaboratore. */
export type MemberAccess = TeamMember & { authority: Authority };

/**
 * I permessi e l'ambito **attuali** di un membro, sia collaboratore sia
 * dipendente semplice (`authority = 'none'`, permessi tutti spenti).
 *
 * Serve alla promozione dalla sua scheda: prima di dargli accesso bisogna sapere
 * da dove parte l'interruttore, e per un dipendente che diventa collaboratore
 * per la prima volta è semplicemente tutto spento e l'ambito `all`.
 */
export async function getMemberAccess(
  memberId: string
): Promise<MemberAccess | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(TEAM_SELECT)
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as RawTeamRow;
  return { ...toTeamMember(row), authority: row.authority };
}

/**
 * I messaggi dei vincoli DB non ancora tradotti da `userErrorMessage`.
 *
 * ⚠️ `UserFacingError` e non `Error`: `userErrorMessage()` generalizza qualunque
 * messaggio non marcato, e queste frasi sono scritte per essere lette così come
 * sono (vedi src/lib/errors.ts).
 */
function teamError(message: string): Error {
  if (message.includes("already_owns_venues") || message.includes("owner")) {
    return new UserFacingError(
      "Questa persona ha già un'azienda sua su KlokShift."
    );
  }
  return new Error(message);
}

export type AddTeamMemberInput = {
  workspaceId: string;
  fullName: string;
  email: string;
  permissions: TeamPermissions;
  scope: VenueScope;
  /** Le sedi dell'ambito. Ignorate quando `scope === "all"`. */
  venueIds: string[];
};

export type AddTeamMemberResult =
  /** La persona ha già un account: deve accettare l'invito in-app. */
  | { kind: "invited_in_app" }
  /** Nessun account: link con token monouso (o no, se l'SMTP ha detto no). */
  | {
      kind: "invite_email";
      emailSent: boolean;
      /** Perché l'email non è partita, già in italiano. Assente se è partita. */
      emailError?: string;
    }
  /** Era già un collaboratore di questa azienda: niente da fare. */
  | { kind: "already" };

/**
 * Aggiunge un collaboratore: una sola RPC (`add_member` con
 * `p_authority: 'collaborator'`), atomica.
 *
 * ⚠️ Scegliere l'ambito «solo alcune sedi» mette quelle sedi anche nel `p_venues`
 * della RPC (con `in_scope: true`): è l'unico modo con cui la RPC riceve
 * l'ambito, e per costruzione **mette anche il collaboratore in organico** su
 * quelle sedi (`venue_members`, `employment_type: 'a_chiamata'`). Authority e
 * organico restano ortogonali (vedi `supabase/README.md`): comparirà anche
 * nell'elenco dello staff di quelle sedi, non solo fra i collaboratori.
 */
export async function addTeamMember(
  input: AddTeamMemberInput
): Promise<AddTeamMemberResult> {
  const email = input.email.trim().toLowerCase();
  const { data, error } = await supabase.rpc("add_member", {
    p_workspace: input.workspaceId,
    p_person: { full_name: input.fullName.trim(), email },
    p_authority: "collaborator",
    p_perms: fromTeamPermissions(input.permissions) as unknown as Json,
    p_scope: input.scope,
    p_venues: (input.scope === "selected"
      ? input.venueIds.map((venue_id) => ({ venue_id, in_scope: true }))
      : []) as unknown as Json,
  });
  if (error) throw teamError(error.message);

  const res = data as unknown as { member_id: string; outcome: string };
  if (res.outcome === "already_member") return { kind: "already" };
  if (res.outcome === "invited_in_app") return { kind: "invited_in_app" };

  // `invite_email`: nessun account, un link con token monouso verso la
  // dashboard. `created_manual` non capita mai per un collaboratore: la RPC
  // esige un'email quando `p_authority <> 'none'` (`email_required`).
  try {
    await sendStaffInvite(res.member_id);
    return { kind: "invite_email", emailSent: true };
  } catch (e) {
    return {
      kind: "invite_email",
      emailSent: false,
      emailError: e instanceof UserFacingError ? e.message : undefined,
    };
  }
}

/**
 * Cambia permessi e ambito di un collaboratore, o promuove un dipendente a
 * collaboratore. Solo il titolare (`set_member_access` lo impone).
 */
export async function setTeamAccess(args: {
  memberId: string;
  permissions: TeamPermissions;
  scope: VenueScope;
  venueIds: string[];
}): Promise<void> {
  const { error } = await supabase.rpc("set_member_access", {
    p_member: args.memberId,
    p_authority: "collaborator",
    p_perms: fromTeamPermissions(args.permissions) as unknown as Json,
    p_scope: args.scope,
    p_scope_venues: args.scope === "selected" ? args.venueIds : [],
  });
  if (error) throw teamError(error.message);
}

/**
 * Toglie l'accesso alla gestione: torna un dipendente senza poteri
 * (`authority: 'none'`). Resta nell'organico dov'era già — questo non lo tocca.
 */
export async function revokeTeamAccess(memberId: string): Promise<void> {
  const { error } = await supabase.rpc("set_member_access", {
    p_member: memberId,
    p_authority: "none",
  });
  if (error) throw teamError(error.message);
}

/** Rimanda il link d'invito (`memberId`, non un indirizzo: vedi `sendStaffInvite`). */
export async function sendTeamInvite(memberId: string): Promise<void> {
  await sendStaffInvite(memberId);
}
