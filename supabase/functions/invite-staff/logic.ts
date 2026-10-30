/** Un nome interpolato in un'email non può introdurre intestazioni o righe. */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** Errori solo nei log server, senza token, hash o credenziali conosciute. */
export function errorForLog(error: unknown, secrets: readonly string[]): string {
  const details = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown } : null;
  const message = typeof details?.code === "string" ? details.code
    : typeof details?.message === "string" ? details.message : String(error);
  return secrets.filter(Boolean).reduce(
    (text, secret) => text.replaceAll(secret, "[redatto]"), message
  );
}

/**
 * I nomi dei permessi come li legge chi gestisce. ⚠️ Gemello **manuale** di
 * `TEAM_PERMISSION_LABEL` (src/features/workspace/permissions.ts): la function
 * gira in Deno e non importa da `src/`. Il test `inviteStaff.test.ts` li tiene
 * uguali.
 */
export const TEAM_ACCESS_LABELS = {
  can_shifts: "Turni",
  can_staff: "Team",
  can_hours: "Ore ed export",
  can_documents: "Documenti",
  can_venue: "Dati della sede",
} as const;

/** Permessi e ambito del collaboratore, come stanno su `workspace_members`. */
export type TeamAccess = Record<keyof typeof TEAM_ACCESS_LABELS, boolean> & {
  scope: "all" | "selected";
  /** Le sedi dell'elenco (`member_scope`), aperte. */
  venues: string[];
};

function joinList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Cosa potrà fare e dove, in due frasi per l'email d'invito. Prima l'email
 * prometteva «da lì organizzi i turni» anche a chi aveva solo le ore.
 */
export function teamAccessLines(access: TeamAccess): { can: string; where: string } {
  const granted = (Object.keys(TEAM_ACCESS_LABELS) as (keyof typeof TEAM_ACCESS_LABELS)[])
    .filter((key) => access[key])
    .map((key) => TEAM_ACCESS_LABELS[key]);
  const where = access.scope === "all"
    ? "tutte le sedi, anche quelle che apriranno"
    : access.venues.length > 0
      ? joinList(access.venues.map(oneLine))
      : "nessuna sede per ora: te le assegna il titolare";
  return {
    can: granted.length > 0
      ? `Puoi gestire: ${joinList(granted)}.`
      : "Per ora puoi solo consultare: i permessi te li dà il titolare.",
    where: `Sedi: ${where}.`,
  };
}
