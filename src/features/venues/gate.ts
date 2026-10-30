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
    return { allowed: false, reason: "Non riusciamo a leggere quante sedi prevede il tuo piano. Riprova tra poco." };
  }
  return access.usage.venues < access.limits.venues
    ? { allowed: true }
    : { allowed: false, reason: `Il tuo piano prevede ${access.limits.venues === 1 ? "1 sede aperta" : `${access.limits.venues} sedi aperte`}. Se chiudi una sede, il suo storico resta.` };
}

/**
 * Cosa mostra «Nuova sede». Il punto delicato è `first`: crea un'**azienda**
 * nuova, quindi si decide solo con il contesto caricato senza errori. Un
 * contesto in errore ha anche lui `workspaceId` assente, ma è un dato mancante
 * e non sblocca niente: senza questa distinzione un errore di rete apriva una
 * seconda azienda.
 */
export type VenueNewMode = "loading" | "error" | "first" | "add" | "denied";

export function venueNewMode(args: {
  isPending: boolean;
  isError: boolean;
  workspaceId?: string;
  isOwner: boolean;
  accessPending: boolean;
}): VenueNewMode {
  if (args.isPending) return "loading";
  if (args.isError) return "error";
  if (!args.workspaceId) return "first";
  // Come `create_venue` e la dashboard: aprire una sede non si delega.
  if (!args.isOwner) return "denied";
  if (args.accessPending) return "loading";
  return "add";
}
