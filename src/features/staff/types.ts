import type { Tables } from "@/types/database";
import type {
  Authority,
  EmploymentType,
  MemberStatus,
} from "@/features/workspace/types";

/**
 * I tipi di dominio dell'organico, gli stessi che le schermate già usano.
 *
 * Dal 20/09/2026 sotto ci sono `workspace_members` (la **persona** nell'azienda)
 * e `venue_members` (la sua **riga di organico** in una sede), che sostituiscono
 * `staff_people` / `staff_members` / `venue_access`. Qui i nomi restano quelli di
 * prima perché le schermate li importano ovunque: cambiano i campi solo dove il
 * modello è davvero cambiato.
 *
 * Due id da non confondere (nel codice nuovo conviene dirlo nel nome):
 *   - `StaffPerson.id`  = `workspace_members.id`  → «member id»
 *   - `StaffMember.id`  = `venue_members.id`      → «venue member id», è ciò a
 *     cui puntano le assegnazioni (`shift_assignments.venue_member_id`).
 *
 * Nessun import di Expo o di React Native: la dashboard web li riusa.
 */

/** Lo stato del legame in una sede, com'era `staff_members.link_status`. */
export type LinkStatus = "pending" | "active" | "left";

/**
 * Da stato del membro e uscita dalla sede al vecchio `link_status`.
 * `invited` = in attesa di accettare; uscito dalla sede o dall'azienda = `left`.
 */
export function linkStatusOf(
  memberStatus: MemberStatus,
  venueLeftAt: string | null
): LinkStatus {
  if (memberStatus === "left" || venueLeftAt) return "left";
  return memberStatus === "invited" ? "pending" : "active";
}

/** Una mansione della persona, come la carica l'embed dell'organico. */
export type StaffRoleRef = { id: string; name: string; sort_order: number };

/**
 * La persona nell'azienda: anagrafica, account collegato, contratto.
 * Riga di `workspace_members` + `member_hr`.
 *
 * `waiter_id` è l'account (`workspace_members.user_id`): il nome resta perché è
 * interno e non si rinomina.
 */
export type StaffPerson = {
  /** `workspace_members.id`. */
  id: string;
  workspace_id: string;
  /** `display_name`. */
  full_name: string;
  phone: string | null;
  /** Le note stanno in `member_hr`: le legge chi ha «Organico». */
  note: string | null;
  email: string | null;
  /** L'account collegato, se la persona ne ha uno. */
  waiter_id: string | null;
  authority: Authority;
  status: MemberStatus;
  contract_hours: number | null;
  contract_period: "day" | "week" | "month" | null;
  /** Ultimo invio dell'invito (`member_invites.last_sent_at`). */
  invited_at: string | null;
  invite_count: number;
  /** `link_conflict_at`: l'account è già in azienda con un'altra scheda. */
  invite_conflict_at: string | null;
  created_at: string;
};

/** La persona in una sede: la riga di organico (`venue_members`). */
export type StaffMember = {
  /** `venue_members.id`. */
  id: string;
  venue_id: string;
  /** `venue_members.member_id`: la persona a cui appartiene la riga. */
  person_id: string;
  display_name: string;
  waiter_id: string | null;
  phone: string | null;
  note: string | null;
  employment_type: EmploymentType;
  link_status: LinkStatus;
  left_at: string | null;
  created_at: string;
};

export type ProfileBrief = Pick<
  Tables<"profiles">,
  "id" | "full_name" | "avatar_url"
>;

/** Riga di organico + foto e nome dell'account collegato + mansioni. */
export type StaffMemberWithWaiter = StaffMember & {
  waiter: ProfileBrief | null;
  staff_member_roles: { role: StaffRoleRef | null }[];
};

/** Una sede in cui la persona lavora, con quel che è **della sede**. */
export type PersonMembership = Pick<
  StaffMember,
  "id" | "venue_id" | "link_status" | "employment_type" | "created_at" | "left_at"
> & {
  venue: Pick<Tables<"venues">, "id" | "name" | "city" | "closed_at"> | null;
  staff_member_roles: { role: StaffRoleRef | null }[];
};

/** Una persona dell'azienda, con le sedi in cui lavora e la sua foto. */
export type OwnerPerson = StaffPerson & {
  waiter: ProfileBrief | null;
  memberships: (Pick<
    StaffMember,
    "id" | "venue_id" | "link_status" | "employment_type"
  > & {
    venue: Pick<Tables<"venues">, "id" | "name" | "city" | "closed_at"> | null;
    staff_member_roles: { role: StaffRoleRef | null }[];
  })[];
};

/**
 * La scheda della persona: tutte le appartenenze, e di suo — compleanno e
 * lingue — quel poco che mette lei dal proprio profilo e che l'azienda legge
 * senza poterlo scrivere.
 */
export type StaffPersonDetail = StaffPerson & {
  waiter:
    | (ProfileBrief &
        Pick<Tables<"profiles">, "birth_day" | "birth_month"> & {
          languages: string[];
        })
    | null;
  memberships: PersonMembership[];
};
