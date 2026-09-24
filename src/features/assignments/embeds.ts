import type { Enums } from "@/types/database";
import {
  linkStatusOf,
  type ProfileBrief,
  type StaffMember,
  type StaffRoleRef,
} from "@/features/staff/types";

/**
 * Dalla riga di organico (`venue_members`) alla forma `StaffMember` che le
 * schermate leggono da sempre.
 *
 * Una riga di organico non porta più nome, telefono e account: stanno sulla
 * **persona** (`workspace_members`), che si raggiunge con un embed. Qui si
 * riunisce il tutto, così ogni assegnazione continua ad avere un
 * `staff_member.display_name` / `waiter_id` senza che le schermate sappiano
 * dell'altra tabella.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa.
 */

/** Il minimo: chi è la riga, di quale persona e con quale account. */
export const VENUE_MEMBER_BRIEF =
  "venue_member:venue_members(id, member_id, member:workspace_members(display_name, user_id))";

/** Come sopra, ma con un inner join: serve a filtrare per account. */
export const VENUE_MEMBER_BY_ACCOUNT =
  "venue_member:venue_members!inner(clock_method, member:workspace_members!inner(user_id))";

/** Riga completa: persona, foto dell'account, mansioni. */
export const VENUE_MEMBER_FULL =
  "venue_member:venue_members(id, venue_id, member_id, employment_type, clock_method, left_at, created_at, member:workspace_members(display_name, user_id, phone, status, waiter:profiles(id, full_name, avatar_url)), venue_member_roles(role:venue_roles(id, name, sort_order)))";

/** Come `VENUE_MEMBER_FULL`, con anche la reputazione (home del gestore). */
export const VENUE_MEMBER_WITH_RATING =
  "venue_member:venue_members!inner(id, venue_id, member_id, employment_type, clock_method, left_at, created_at, member:workspace_members(display_name, user_id, phone, status, waiter:profiles(id, full_name, avatar_url, waiter_profile:waiter_profiles(rating_avg, rating_count))))";

type RawWaiter = ProfileBrief | null;

export type RawVenueMember<W = RawWaiter> = {
  id: string;
  venue_id: string;
  member_id: string;
  employment_type: Enums<"employment_type">;
  clock_method: Enums<"clock_method"> | null;
  left_at: string | null;
  created_at: string;
  member: {
    display_name: string;
    user_id: string | null;
    phone: string | null;
    status: Enums<"member_status">;
    waiter: W;
  } | null;
  venue_member_roles?: { role: StaffRoleRef | null }[];
};

/** `StaffMember` + l'account collegato (com'è nell'embed) + le mansioni. */
export function toStaffMember<W>(
  vm: RawVenueMember<W>
): StaffMember & {
  waiter: W | null;
  staff_member_roles: { role: StaffRoleRef | null }[];
} {
  const m = vm.member;
  return {
    id: vm.id,
    venue_id: vm.venue_id,
    person_id: vm.member_id,
    display_name: m?.display_name ?? "",
    waiter_id: m?.user_id ?? null,
    phone: m?.phone ?? null,
    // Le note stanno in `member_hr`: le legge chi ha «Organico», non le
    // schermate dei turni.
    note: null,
    employment_type: vm.employment_type,
    link_status: linkStatusOf(m?.status ?? "active", vm.left_at),
    left_at: vm.left_at,
    created_at: vm.created_at,
    waiter: m?.waiter ?? null,
    staff_member_roles: vm.venue_member_roles ?? [],
  };
}
