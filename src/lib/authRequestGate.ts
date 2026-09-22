export type AuthRequestTicket = {
  revision: number;
  userId: string | null;
};

/**
 * Coordina bootstrap, eventi auth e letture profilo senza conoscere React.
 * Ogni nuova identità/richiesta invalida i risultati ancora in volo.
 */
export function createAuthRequestGate() {
  let revision = 0;
  let userId: string | null = null;

  return {
    snapshot(): number {
      return revision;
    },

    isSnapshotCurrent(snapshot: number): boolean {
      return snapshot === revision;
    },

    begin(nextUserId: string | null): AuthRequestTicket {
      userId = nextUserId;
      revision += 1;
      return { revision, userId };
    },

    invalidate(nextUserId: string | null): void {
      userId = nextUserId;
      revision += 1;
    },

    isCurrent(ticket: AuthRequestTicket): boolean {
      return ticket.revision === revision && ticket.userId === userId;
    },
  };
}
