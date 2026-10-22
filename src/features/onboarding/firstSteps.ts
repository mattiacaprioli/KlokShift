import { canUseWorkspaceOperations, type WorkspaceAccess } from "@/features/workspace/access";

/**
 * «Primi passi» del titolare: cosa manca perché l'azienda giri davvero.
 *
 * Nessun passo si spunta a mano: ognuno è vero o falso guardando i dati (prova,
 * ruoli, organico, turni, inviti). Così la checklist non mente mai, e la stessa
 * logica serve app e dashboard. Solo dati, niente React né Expo.
 *
 * L'ordine è quello che impone il server: senza prova (`setup`) ruoli, persone e
 * turni sono rifiutati, quindi i passi dopo il primo restano «bloccati».
 */
export type FirstStepId = "trial" | "roles" | "people" | "shift" | "team";
export type FirstStepStatus = "done" | "todo" | "locked";

export type FirstStep = {
  id: FirstStepId;
  title: string;
  detail: string;
  cta: string;
  status: FirstStepStatus;
};

export type FirstStepsInput = {
  isOwner: boolean;
  access: WorkspaceAccess | undefined;
  /** Almeno una sede aperta. */
  hasVenue: boolean;
  /** Chi sta guardando: la sua scheda in organico non conta come «persone». */
  myUserId: string | undefined;
  /** `undefined` = non ancora caricato. */
  activeRoleCount: number | undefined;
  people:
    | readonly { waiter_id: string | null; invited_at: string | null; email: string | null }[]
    | undefined;
  hasAnyShift: boolean | undefined;
};

export type FirstStepsState = {
  /** Da mostrare a questa persona, per questa azienda. */
  visible: boolean;
  /** Tutti i dati che servono sono arrivati: prima, niente card (niente sfarfallio). */
  ready: boolean;
  steps: FirstStep[];
  doneCount: number;
  /** Il primo passo da fare: è quello col bottone. */
  next: FirstStep | null;
  allDone: boolean;
  /**
   * Si può chiudere solo a prova avviata: chiusa prima, al titolare non
   * resterebbe nessun invito a sbloccare l'azienda.
   */
  canDismiss: boolean;
};

const COPY: Record<FirstStepId, Omit<FirstStep, "id" | "status">> = {
  trial: {
    title: "Avvia la prova di 30 giorni",
    detail: "Gratis e senza carta: sblocca persone, ruoli e turni.",
    cta: "Avvia la prova",
  },
  roles: {
    title: "Scegli i ruoli",
    detail: "Sala, bar, cucina…: li chiedi sui turni e li dai alle persone.",
    cta: "Aggiungi i ruoli",
  },
  people: {
    title: "Aggiungi le persone",
    detail: "Nome ed email di chi lavora con te. Se lavori anche tu, mettiti in organico.",
    cta: "Aggiungi una persona",
  },
  shift: {
    title: "Crea il primo turno",
    detail: "Giorno, orario e chi lavora: le persone ricevono la notifica.",
    cta: "Crea un turno",
  },
  team: {
    title: "Fai entrare il team",
    detail: "Chi si registra all'app con l'email della sua scheda trova subito i suoi turni.",
    cta: "Vai allo staff",
  },
};

/** Con le persone già aggiunte ma nessuna email, il passo dice cosa manca. */
const TEAM_NO_EMAIL =
  "Aggiungi l'email sulla scheda di una persona: l'invito parte da lì.";

const VISIBLE_STATES: readonly WorkspaceAccess["state"][] = [
  "setup",
  "operational",
  "migration_pending",
];

export function computeFirstSteps(input: FirstStepsInput): FirstStepsState {
  const { access } = input;
  const visible =
    input.isOwner && input.hasVenue && !!access && VISIBLE_STATES.includes(access.state);

  const unlocked = canUseWorkspaceOperations(access);
  const others = (input.people ?? []).filter(
    (p) => !p.waiter_id || p.waiter_id !== input.myUserId
  );
  const done: Record<FirstStepId, boolean | undefined> = {
    trial: unlocked,
    roles: input.activeRoleCount === undefined ? undefined : input.activeRoleCount > 0,
    people: input.people === undefined ? undefined : others.length > 0,
    shift: input.hasAnyShift,
    team:
      input.people === undefined
        ? undefined
        : others.some((p) => !!p.waiter_id || !!p.invited_at),
  };

  // Senza prova gli altri passi sono bloccati e i loro dati non servono.
  const ready =
    !!access && (!unlocked || Object.values(done).every((value) => value !== undefined));

  const steps: FirstStep[] = (Object.keys(COPY) as FirstStepId[]).map((id) => {
    const status: FirstStepStatus =
      done[id] === true ? "done" : id !== "trial" && !unlocked ? "locked" : "todo";
    const detail =
      id === "team" && status === "todo" && others.length > 0 && !others.some((p) => p.email)
        ? TEAM_NO_EMAIL
        : COPY[id].detail;
    return { id, ...COPY[id], detail, status };
  });

  const doneCount = steps.filter((s) => s.status === "done").length;
  const next = steps.find((s) => s.status === "todo") ?? null;
  return {
    visible,
    ready,
    steps,
    doneCount,
    next,
    allDone: doneCount === steps.length,
    canDismiss: unlocked,
  };
}

/**
 * Cosa ricorda la card, per persona e azienda: chiusa a mano, oppure finita
 * (e allora non torna nemmeno se un giorno l'organico si svuota).
 */
export type FirstStepsMemory = "dismissed" | "completed";

export const firstStepsKey = (userId: string, workspaceId: string) =>
  `firstSteps.${userId}.${workspaceId}`;

export function parseFirstStepsMemory(raw: string | null): FirstStepsMemory | null {
  return raw === "dismissed" || raw === "completed" ? raw : null;
}
