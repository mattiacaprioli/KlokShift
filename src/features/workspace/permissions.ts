/**
 * I cinque permessi del collaboratore e il loro vocabolario.
 *
 * ⚠️ Le chiavi restano quelle storiche (`can_manage_shifts`…): sono le stringhe
 * che la UI passa a `useOwnerVenues().can(venueId, perm)` in decine di punti, e
 * cambiarle non darebbe niente. Il DB usa i nomi corti (`shifts`, `staff`,
 * `hours`, `documents`, `venue`) — la traduzione sta qui, in `PERM_OF`, e da
 * nessun'altra parte.
 *
 * Nessun import di Expo o di React Native: la dashboard web lo riusa.
 */
export const TEAM_PERMISSIONS = [
  "can_manage_shifts",
  "can_manage_staff",
  "can_view_hours",
  "can_manage_documents",
  "can_manage_venue",
] as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

/** I permessi come li conosce il DB (`workspace_members.can_*`, `get_my_context`). */
export type Perm = "shifts" | "staff" | "hours" | "documents" | "venue";

export const PERM_OF: Record<TeamPermission, Perm> = {
  can_manage_shifts: "shifts",
  can_manage_staff: "staff",
  can_view_hours: "hours",
  can_manage_documents: "documents",
  can_manage_venue: "venue",
};

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

/** Nessun permesso: il punto di partenza di un collaboratore appena invitato. */
export const NO_PERMISSIONS: TeamPermissions = {
  can_manage_shifts: false,
  can_manage_staff: false,
  can_view_hours: false,
  can_manage_documents: false,
  can_manage_venue: false,
};

/** I permessi del DB (`{shifts: true, …}`) nella forma della UI. */
export function toTeamPermissions(perms: Record<Perm, boolean>): TeamPermissions {
  return {
    can_manage_shifts: !!perms.shifts,
    can_manage_staff: !!perms.staff,
    can_view_hours: !!perms.hours,
    can_manage_documents: !!perms.documents,
    can_manage_venue: !!perms.venue,
  };
}

/** La forma della UI nel payload delle RPC (`{shifts: true, …}`). */
export function fromTeamPermissions(p: TeamPermissions): Record<Perm, boolean> {
  return {
    shifts: p.can_manage_shifts,
    staff: p.can_manage_staff,
    hours: p.can_view_hours,
    documents: p.can_manage_documents,
    venue: p.can_manage_venue,
  };
}
