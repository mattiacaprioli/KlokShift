import type { StaffRoleRef } from "@/features/staff/types";

/**
 * Il ruolo da preselezionare quando si aggiunge una persona a un turno: il suo,
 * se ne ha uno solo. Con più mansioni resta da scegliere — indovinare
 * direbbe "coperto" un fabbisogno che nessuno ha confermato di coprire.
 *
 * Nessun import di React Native: lo usa anche la dashboard web.
 */
export function defaultRoleFor(member: {
  staff_member_roles: { role: StaffRoleRef | null }[];
}): string | null {
  const roles = member.staff_member_roles
    .map((r) => r.role)
    .filter((r): r is NonNullable<typeof r> => !!r);
  return roles.length === 1 ? roles[0].id : null;
}
