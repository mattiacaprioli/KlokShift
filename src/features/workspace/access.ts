/**
 * Accesso commerciale dell'azienda, distinto dai permessi del membro.
 * Risposta pubblica di `get_workspace_access`: nessun prezzo o dato provider.
 * Non importa Expo/React Native: app e dashboard condividono il contratto.
 */
const ACCESS_STATES = [
  "setup",
  "operational",
  "archive",
  "expired",
  "migration_pending",
] as const;
const ACCESS_SOURCES = [
  "trial",
  "complimentary_lifetime",
  "complimentary_temporary",
  "transition",
] as const;
const ACCESS_PLANS = ["base", "team"] as const;

export type WorkspaceAccessState = (typeof ACCESS_STATES)[number];
export type WorkspaceAccessSource = (typeof ACCESS_SOURCES)[number];
export type WorkspaceAccessPlan = (typeof ACCESS_PLANS)[number];

export type WorkspaceAccess = {
  workspace_id: string;
  state: WorkspaceAccessState;
  source: WorkspaceAccessSource | null;
  plan: WorkspaceAccessPlan | null;
  operational_from: string | null;
  operational_until: string | null;
  archive_until: string | null;
  attendance_until: string | null;
  can_operate: boolean;
  can_read: boolean;
  can_complete_attendance: boolean;
  /** `people: null` significa senza limite soltanto con piano Team esplicito. */
  limits: { people: number | null; venues: number | null };
  /** I dipendenti non ricevono gli aggregati dell'intera azienda. */
  usage: { people: number; venues: number } | null;
};

function invalidAccess(): never {
  throw new Error("workspace_access_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidAccess();
  }
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return invalidAccess();
  }
  return value as T;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") return invalidAccess();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidAccess();
  }
  return value;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  // Postgres restituisce un istante ISO con offset, non una data locale.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidAccess();
  }
  return value;
}

/**
 * Una risposta incompleta/incoerente fallisce, senza trasformarsi in Pro o in
 * capacità infinita. I campi extra non vengono propagati dal data layer.
 * Le date e i diritti li decide il server: qui si verifica soltanto il formato.
 */
export function parseWorkspaceAccess(value: unknown): WorkspaceAccess {
  const raw = record(value);
  const limits = record(raw.limits);
  const usage = raw.usage === null ? null : record(raw.usage);
  if (typeof raw.workspace_id !== "string" || !raw.workspace_id.trim()) {
    return invalidAccess();
  }
  const access: WorkspaceAccess = {
    workspace_id: raw.workspace_id,
    state: enumValue(raw.state, ACCESS_STATES),
    source: raw.source === null ? null : enumValue(raw.source, ACCESS_SOURCES),
    plan: raw.plan === null ? null : enumValue(raw.plan, ACCESS_PLANS),
    operational_from: timestamp(raw.operational_from),
    operational_until: timestamp(raw.operational_until),
    archive_until: timestamp(raw.archive_until),
    attendance_until: timestamp(raw.attendance_until),
    can_operate: booleanValue(raw.can_operate),
    can_read: booleanValue(raw.can_read),
    can_complete_attendance: booleanValue(raw.can_complete_attendance),
    limits: {
      people: limits.people === null ? null : count(limits.people),
      venues: limits.venues === null ? null : count(limits.venues),
    },
    usage: usage === null ? null : { people: count(usage.people), venues: count(usage.venues) },
  };

  if (
    access.can_operate !== (access.state === "operational") ||
    access.can_read !== (access.state !== "expired") ||
    (access.state === "operational" && !access.can_complete_attendance)
  ) {
    return invalidAccess();
  }

  if (access.state === "setup" || access.state === "migration_pending") {
    if (
      access.source !== null || access.plan !== null ||
      access.operational_from !== null || access.operational_until !== null ||
      access.archive_until !== null || access.attendance_until !== null ||
      access.limits.people !== null || access.limits.venues !== null ||
      access.can_complete_attendance
    ) {
      return invalidAccess();
    }
    return access;
  }

  if (
    access.source === null || access.plan === null || access.operational_from === null ||
    access.limits.venues === null || access.limits.venues < 1 ||
    (access.plan === "base" && access.limits.people !== 30) ||
    (access.plan === "team" && access.limits.people !== null)
  ) {
    return invalidAccess();
  }

  if (access.operational_until === null) {
    if (
      access.source !== "complimentary_lifetime" || access.state !== "operational" ||
      access.archive_until !== null || access.attendance_until !== null
    ) {
      return invalidAccess();
    }
  } else {
    if (
      access.archive_until === null || access.attendance_until === null ||
      Date.parse(access.operational_until) <= Date.parse(access.operational_from) ||
      Date.parse(access.archive_until) <= Date.parse(access.operational_until) ||
      Date.parse(access.attendance_until) < Date.parse(access.operational_until) ||
      Date.parse(access.attendance_until) > Date.parse(access.archive_until)
    ) {
      return invalidAccess();
    }
  }
  if (access.state === "expired" && access.can_complete_attendance) {
    return invalidAccess();
  }
  return access;
}

/** Un solo prossimo confine; nessun polling per concessioni permanenti. */
export function workspaceAccessRefetchDelay(
  access: WorkspaceAccess | undefined,
  now: number = Date.now()
): number | false {
  if (!access) return false;
  // Un dato rientrato dalla cache può aver superato il suo confine mentre la
  // schermata non era montata. Non aspettare il focus per correggere i diritti.
  if (
    (access.state === "operational" && access.operational_until !== null &&
      Date.parse(access.operational_until) <= now) ||
    (access.state === "archive" && (
      (access.archive_until !== null && Date.parse(access.archive_until) <= now) ||
      (access.can_complete_attendance && access.attendance_until !== null &&
        Date.parse(access.attendance_until) <= now)
    ))
  ) {
    return 1_000;
  }
  const dates = access.state === "operational"
    ? [access.operational_until]
    : access.state === "archive"
      ? [access.attendance_until, access.archive_until]
      : [];
  const next = dates
    .filter((date): date is string => date !== null)
    .map((date) => Date.parse(date))
    .filter((date) => date > now)
    .sort((a, b) => a - b)[0];
  if (next === undefined) return false;
  // Limite del timer JS: evita che una scadenza a mesi diventi un loop a 1 ms.
  return Math.min(2_147_483_647, Math.max(1_000, next - now + 250));
}
