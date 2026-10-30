import {
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_HINT,
  TEAM_PERMISSION_LABEL,
  toTeamPermissions,
  type TeamPermission,
} from "@/features/workspace/permissions";
import type { Membership } from "@/features/workspace/types";

/**
 * Il benvenuto del collaboratore, in parole: cosa può fare, su quali sedi, cosa
 * resta al titolare e da dove cominciare. Tutto da `get_my_context` (permessi e
 * ambito stanno sul membro), nessuna query in più. Solo dati: la dashboard lo
 * mostra, l'app può riusarlo.
 */
export type CollaboratorSummary = {
  workspaceName: string;
  can: { perm: TeamPermission; label: string; hint: string }[];
  venues: string;
  ownerKeeps: string;
  /** La prima pagina utile sulla dashboard; `null` senza nessun permesso. */
  start: { path: string; label: string } | null;
};

/** Dove porta ciascun permesso, nell'ordine in cui conviene cominciare. */
const START: Record<TeamPermission, { path: string; label: string }> = {
  can_manage_shifts: { path: "/planning", label: "Apri il planning" },
  can_manage_staff: { path: "/staff", label: "Apri il team" },
  can_view_hours: { path: "/ore", label: "Apri le ore" },
  can_manage_documents: { path: "/staff", label: "Apri il team" },
  can_manage_venue: { path: "/sede", label: "Apri la sede" },
};

export const OWNER_KEEPS =
  "Piano dell'azienda, nuove sedi e collaboratori restano al titolare.";

export function collaboratorSummary(m: Membership): CollaboratorSummary {
  const perms = toTeamPermissions(m.perms);
  const granted = TEAM_PERMISSIONS.filter((p) => perms[p]);
  const open = m.venues.filter((v) => v.closed_at === null).map((v) => v.name);
  const venues =
    m.scope === "all"
      ? "Tutte le sedi, anche quelle che apriranno."
      : open.length === 0
        ? "Ancora nessuna sede: il titolare te le assegna dalla pagina Collaboratori."
        : open.length === 1
          ? `La sede ${open[0]}.`
          : `Le sedi ${open.slice(0, -1).join(", ")} e ${open[open.length - 1]}.`;
  return {
    workspaceName: m.workspace_name,
    can: granted.map((perm) => ({
      perm,
      label: TEAM_PERMISSION_LABEL[perm],
      hint: TEAM_PERMISSION_HINT[perm],
    })),
    venues,
    ownerKeeps: OWNER_KEEPS,
    start: granted.length > 0 ? START[granted[0]] : null,
  };
}
