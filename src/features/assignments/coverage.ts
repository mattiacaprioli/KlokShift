import type { Enums } from "@/types/database";
import { isActiveAssignment, type AssignmentStatus } from "./status";

/**
 * Un fabbisogno del turno. `role` è il nome da mostrare, `role_id` quello su cui
 * si fa il match: i ruoli sono righe di `venue_roles`, quindi rinominarne uno
 * non scollega più niente — cosa che con il confronto per stringa succedeva in
 * silenzio.
 */
export type RoleRequirement = {
  role_id: string;
  role: string;
  count: number;
};
export type CoverageAssignment = {
  status: AssignmentStatus;
  role_id: string | null;
};

export type CoverageRow = { role: string; required: number; covered: number };
export type Coverage = {
  rows: CoverageRow[];
  required: number;
  covered: number;
  missing: number;
};

/**
 * Copertura per ruolo: per ogni fabbisogno conta gli assegnati attivi che
 * lavorano in **quel** ruolo su **questo** turno. L'eccedenza su un ruolo non
 * copre gli altri (min con il richiesto).
 *
 * Il ruolo è quello scelto sull'assegnazione, non quello dell'anagrafica: chi fa
 * il cameriere e il barman copre l'uno o l'altro a seconda della sera, e
 * dedurlo dalla scheda lo faceva contare due volte.
 */
export function computeCoverage(
  requirements: RoleRequirement[],
  assignments: CoverageAssignment[]
): Coverage {
  const active = assignments.filter((a) => isActiveAssignment(a.status));
  const rows: CoverageRow[] = requirements.map((req) => ({
    role: req.role,
    required: req.count,
    covered: active.filter((a) => a.role_id === req.role_id).length,
  }));
  const required = rows.reduce((s, r) => s + r.required, 0);
  const covered = rows.reduce((s, r) => s + Math.min(r.covered, r.required), 0);
  return { rows, required, covered, missing: Math.max(0, required - covered) };
}

/**
 * Le due relazioni da cui si legge la copertura di un turno, così come le
 * caricano le query (`shift_role_requirements(...)` + `shift_assignments(...)`).
 * Il nome del ruolo arriva dall'embed su `venue_roles`.
 */
export type RoleRequirementEmbed = {
  role_id: string;
  count: number;
  role: { name: string } | null;
};

export type CoverageEmbeds = {
  shift_role_requirements: RoleRequirementEmbed[];
  shift_assignments: {
    status: AssignmentStatus;
    role_id: string | null;
    /**
     * Facoltativo: la copertura non lo guarda. Lo porta `getOwnerShifts` perché
     * l'agenda della sede deve poter riconoscere i turni di **chi guarda** —
     * chi gestisce può stare in organico — e un'altra query per saperlo
     * costerebbe più del campo.
     */
    staff_member_id?: string | null;
  }[];
};

/** Un fabbisogno come arriva dal DB → come lo vogliono i conteggi. */
export function toRoleRequirement(r: RoleRequirementEmbed): RoleRequirement {
  return {
    role_id: r.role_id,
    // Il ruolo esiste sempre (FK not null); il fallback copre solo il caso in cui
    // la RLS nasconda la riga di `venue_roles` a chi sta guardando.
    role: r.role?.name ?? "Ruolo",
    count: r.count,
  };
}

/**
 * Copertura di un turno già caricato con le sue relazioni: unico punto in cui
 * si passa dalle righe DB agli argomenti di `computeCoverage`, così nessuna
 * schermata può sbagliare la conversione (o inventarsi lo stato).
 */
export function shiftCoverage(shift: CoverageEmbeds): Coverage {
  return computeCoverage(
    shift.shift_role_requirements.map(toRoleRequirement),
    shift.shift_assignments.map((a) => ({
      status: a.status,
      role_id: a.role_id,
    }))
  );
}

/** Turno visto dai conteggi: i posti pubblicati più le relazioni della copertura. */
export type CountableShift = CoverageEmbeds & {
  kind: Enums<"shift_kind">;
  positions_filled: number;
  positions_total: number;
};

/**
 * I due numeri "coperti/da coprire" di un turno, per **tutte** le viste che li
 * mostrano (home, planning, storico, elenchi): su un turno interno con
 * fabbisogno per ruolo vale la copertura per ruolo, altrove valgono i posti
 * (`positions_*`, tenuti dai trigger DB).
 *
 * ⚠️ Chi mostra "x/y" DEVE passare da qui. Leggere `positions_filled` da una
 * parte e la copertura dall'altra fa dire due cose diverse allo stesso turno
 * sulla stessa schermata: i posti contano teste, la copertura conta i ruoli
 * che servono davvero.
 */
/**
 * Il colore di un turno, in una parola sola: verde coperto, arancio scoperto,
 * spento se non c'è più niente da coprire.
 *
 * ⚠️ È **l'unico** posto in cui si decide. Prima ogni vista aveva la sua regola
 * — il mese web colorava il bordo per copertura, la settimana web lo dava alla
 * sede, la card mobile faceva oro-su-tutto — e lo stesso turno cambiava
 * significato passando da una schermata all'altra. Il colore della sede è un
 * altro segnale e vuole un altro supporto (il pallino, il nome): non si mette
 * qui sopra, perché "di chi è" e "è coperto" non possono occupare lo stesso
 * pixel.
 */
export type ShiftTone = "covered" | "short" | "off";

export function shiftTone(
  shift: CountableShift & { status: Enums<"shift_status"> }
): ShiftTone {
  // Annullato o chiuso: non è scoperto: non deve coprirlo più nessuno.
  if (shift.status === "cancelled" || shift.status === "closed") return "off";
  return shiftCounts(shift).short ? "short" : "covered";
}

export function shiftCounts(shift: CountableShift): {
  filled: number;
  total: number;
  short: boolean;
} {
  const coverage = shiftCoverage(shift);
  const byRole = shift.kind === "internal" && coverage.required > 0;
  const filled = byRole ? coverage.covered : shift.positions_filled;
  const total = byRole ? coverage.required : shift.positions_total;
  return { filled, total, short: filled < total };
}
