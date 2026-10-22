import { useAuth } from "@/lib/auth";
import { useOwnerVenueRoles } from "@/features/roles/hooks";
import { useOwnerPastShiftsCount, useOwnerShifts } from "@/features/shifts/hooks";
import { NO_PAST_FILTERS } from "@/features/shifts/pastFilters";
import { useOwnerPeople } from "@/features/staff/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { canUseWorkspaceOperations } from "@/features/workspace/access";
import { computeFirstSteps } from "./firstSteps";

/**
 * I dati della checklist «Primi passi», condivisi da app e dashboard.
 *
 * Nessuna query nuova: ruoli, organico e turni sono le stesse cache di Staff,
 * Ruoli e Home. Quelle dei passi bloccati partono solo a prova avviata, e il
 * conteggio dello storico solo se non c'è nessun turno in programma.
 * `enabled: false` (card chiusa) le spegne tutte tranne i turni, che la Home
 * legge comunque.
 */
export function useFirstSteps(enabled: boolean) {
  const { session } = useAuth();
  const { workspaceId, isOwner, access, venues } = useOwnerVenues();
  const on = enabled && isOwner && !!workspaceId;
  const unlocked = canUseWorkspaceOperations(access);

  const roles = useOwnerVenueRoles({ enabled: on && unlocked });
  const people = useOwnerPeople(on && unlocked ? workspaceId : undefined);
  const upcoming = useOwnerShifts();
  const upcomingCount = upcoming.data?.length;
  const past = useOwnerPastShiftsCount(NO_PAST_FILTERS, {
    enabled: on && unlocked && upcomingCount === 0,
  });

  const hasAnyShift =
    upcomingCount === undefined
      ? undefined
      : upcomingCount > 0 || (past.data === undefined ? undefined : past.data > 0);

  const state = computeFirstSteps({
    isOwner,
    access,
    hasVenue: venues.length > 0,
    myUserId: session?.user.id,
    activeRoleCount: roles.data?.length,
    people: people.data,
    hasAnyShift,
  });

  const myId = session?.user.id;
  return {
    ...state,
    userId: myId,
    workspaceId,
    /** Il titolare ha già la sua scheda: il «mettiti in organico» non serve. */
    hasSelfCard: !!myId && (people.data ?? []).some((p) => p.waiter_id === myId),
  };
}
