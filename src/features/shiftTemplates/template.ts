import type { Json } from "@/types/database";

/** Un fabbisogno del modello: quante persone servono in quel ruolo. */
export type TemplateRoleTarget = { role_id: string; count: number };

/**
 * Ciò che un modello ricorda di un turno. Niente data e niente persone: cambiano
 * da un giorno all'altro, e una persona uscita dal team non deve rientrare
 * in un turno perché era in un modello vecchio.
 */
export type ShiftTemplateInput = {
  name: string;
  /** "HH:MM". */
  start_time: string;
  /** "HH:MM". */
  end_time: string;
  break_minutes: number;
  description: string | null;
  require_confirmation: boolean;
  role_targets: TemplateRoleTarget[];
};

/** Lo stesso tetto della RPC `save_shift_template`. */
export const MAX_TEMPLATE_NAME = 60;

/**
 * `role_targets` arriva come `Json`: si tengono solo le voci ben fatte. Il DB
 * le valida già in scrittura, ma il tipo non lo sa.
 */
export function parseRoleTargets(value: Json): TemplateRoleTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { role_id, count } = item as Record<string, unknown>;
    return typeof role_id === "string" && typeof count === "number" && count > 0
      ? [{ role_id, count }]
      : [];
  });
}

/**
 * Il modello di un turno che esiste già («come venerdì scorso»). Il titolo del
 * turno è il nome proposto; chi salva lo può cambiare.
 */
export function templateFromShift(
  shift: {
    title: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    description: string | null;
    require_confirmation: boolean;
  },
  requirements: readonly { role_id: string; count: number }[]
): ShiftTemplateInput {
  return {
    name: shift.title.trim().slice(0, MAX_TEMPLATE_NAME),
    start_time: shift.start_time.slice(0, 5),
    end_time: shift.end_time.slice(0, 5),
    break_minutes: shift.break_minutes,
    description: shift.description?.trim() || null,
    require_confirmation: shift.require_confirmation,
    role_targets: requirements
      .filter((r) => r.count > 0)
      .map((r) => ({ role_id: r.role_id, count: r.count })),
  };
}

/**
 * I fabbisogni del modello che si possono ancora chiedere: solo i ruoli che la
 * sede assegna oggi. Un ruolo archiviato dopo il salvataggio resta nel modello
 * (il modello è un precompilato, non un vincolo) ma non torna nel form.
 */
export function applicableRoleTargets(
  targets: readonly TemplateRoleTarget[],
  roles: readonly { id: string }[]
): TemplateRoleTarget[] {
  const active = new Set(roles.map((r) => r.id));
  return targets.filter((t) => t.count > 0 && active.has(t.role_id));
}

/**
 * Il modello che quel nome andrebbe a sovrascrivere, se c'è: la RPC confronta i
 * nomi senza maiuscole e spazi ai bordi, e l'avviso deve dire la stessa cosa.
 */
export function findTemplateByName<T extends { name: string }>(
  templates: readonly T[],
  name: string
): T | undefined {
  const key = name.trim().toLocaleLowerCase("it");
  if (!key) return undefined;
  return templates.find((t) => t.name.trim().toLocaleLowerCase("it") === key);
}
