import type { WorkspaceAccess } from "@/features/workspace/access";

export type VenueGate = { allowed: true } | { allowed: false; reason: string };

/** Usa l'aggregato aziendale del server, anche con un ambito ristretto. */
export function canCreateVenue(args: {
  access: WorkspaceAccess | undefined;
  firstWorkspace?: boolean;
}): VenueGate {
  const { access, firstWorkspace } = args;
  if (firstWorkspace) return { allowed: true };
  if (!access) return { allowed: false, reason: "Aggiorna lo stato dell'azienda prima di aggiungere una sede." };
  if (access.state === "migration_pending") return { allowed: true };
  if (access.state === "setup" && access.usage?.venues === 0) return { allowed: true };
  if (!access.can_operate) return { allowed: false, reason: "L'azienda non ha accesso operativo. Puoi consultare lo storico." };
  if (access.usage === null || access.limits.venues === null) {
    return { allowed: false, reason: "Capacità delle sedi non disponibile. Aggiorna lo stato dell'azienda." };
  }
  return access.usage.venues < access.limits.venues
    ? { allowed: true }
    : { allowed: false, reason: `La capacità dell'azienda è di ${access.limits.venues} sedi aperte. Le sedi chiuse conservano lo storico.` };
}
