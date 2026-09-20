import type { Perm } from "./permissions";

/**
 * Chi sono e dove: la risposta di `get_my_context()`.
 *
 * Sostituisce `profile.role`, `getMyVenueAccess`, `getMyEmployers` e
 * `getMyPendingInvites`. Il «cappello» con cui si usa l'app (gestione / lavoro)
 * non è scritto sul profilo: si ricava da queste appartenenze.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa.
 */
export type Authority = "owner" | "collaborator" | "none";
export type MemberStatus = "invited" | "active" | "left";
export type VenueScope = "all" | "selected";
export type EmploymentType = "fisso" | "a_chiamata";

/** Una sede che l'appartenenza **gestisce**, con i permessi su di essa. */
export type ContextVenue = {
  id: string;
  name: string;
  city: string | null;
  closed_at: string | null;
  logo_url: string | null;
  /** I permessi su questa sede, con i derivati `roster` e `any`. */
  perms: string[];
};

/** Una sede in cui l'appartenenza **lavora** (la riga di organico). */
export type ContextWork = {
  venue_member_id: string;
  venue_id: string;
  venue_name: string;
  employment_type: EmploymentType;
};

export type Membership = {
  member_id: string;
  workspace_id: string;
  workspace_name: string;
  plan: "free" | "pro";
  authority: Authority;
  status: MemberStatus;
  display_name: string;
  scope: VenueScope;
  perms: Record<Perm, boolean>;
  venues: ContextVenue[];
  works: ContextWork[];
};

export type MyContext = {
  user_id: string;
  memberships: Membership[];
};

/** Un'appartenenza che dà accesso alla gestione. */
export function isManagerMembership(m: Membership): boolean {
  return m.status === "active" && m.authority !== "none";
}
