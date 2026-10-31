/** Un'azienda che chi gestisce non può usare finché un titolare non accetta. */
export type PendingLegal = {
  workspaceId: string;
  workspaceName: string;
  /** Vero per un titolare: può accettare lui. Falso per un collaboratore. */
  canAccept: boolean;
};

export type LegalGate = {
  blocked: boolean;
  toAccept: PendingLegal[];
  waiting: PendingLegal[];
};

/**
 * Il blocco della vista di gestione, per l'azienda che quella vista mostra
 * (`useOwnerVenues().workspaceId`): un'altra azienda in attesa, che da qui non
 * si raggiunge nemmeno, non deve fermare la gestione di questa.
 */
export function legalGate(rows: PendingLegal[], workspaceId: string | undefined): LegalGate {
  const mine = workspaceId ? rows.filter((r) => r.workspaceId === workspaceId) : [];
  return {
    blocked: mine.length > 0,
    toAccept: mine.filter((r) => r.canAccept),
    waiting: mine.filter((r) => !r.canAccept),
  };
}

export type LegalGateState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; gate: LegalGate };

/**
 * Cosa fa il layout di gestione con la risposta. Un dato già letto vale anche se
 * un refetch successivo fallisce (in TanStack v5 `isError` resta vero accanto ai
 * dati): smontare la gestione per una rete instabile farebbe perdere navigazione
 * e form aperti. Senza dato si aspetta o si mostra l'errore, mai si sblocca.
 */
export function resolveLegalGate(
  query: { data: PendingLegal[] | undefined; isError: boolean },
  workspaceId: string | undefined
): LegalGateState {
  if (query.data) return { status: "ready", gate: legalGate(query.data, workspaceId) };
  return query.isError ? { status: "error" } : { status: "loading" };
}
