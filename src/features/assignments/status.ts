import type { Enums } from "@/types/database";

export type AssignmentStatus = Enums<"assignment_status">;

/**
 * Un'assegnazione "vale" solo se la persona lavora davvero: chi ha rifiutato o
 * è stato segnato assente non copre nulla.
 *
 * ⚠️ Chi mostra o conta gli assegnati DEVE passare da qui: un form che dà per
 * scontato lo stato `assigned` conta come coperti anche i rifiuti, e il turno
 * sembra a posto quando invece manca la persona.
 */
export function isActiveAssignment(status: AssignmentStatus): boolean {
  return status === "assigned" || status === "confirmed";
}

/** Etichette lato sede (il professionista vede "Da confermare" al posto di "Assegnato"). */
export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  assigned: "Assegnato",
  confirmed: "Confermato",
  declined: "Rifiutato",
  no_show: "Assente",
};
