import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { classifications, pageSchema, workspaceStates } from "./types";

/*
 * Attivazione delle aziende nell'area fondatore (`admin_list_activation`):
 * date e conteggi, mai persone. Serve a vedere dove si fermano — sede, prova,
 * persone, primo turno, prima conferma — invece di indovinarlo.
 */

const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const row = z.object({
  workspace_id: id,
  workspace_name: z.string(),
  classification: z.enum(classifications),
  state: z.enum(workspaceStates),
  created_at: date,
  first_venue_at: date.nullable(),
  trial_started_at: date.nullable(),
  people: count,
  with_email: count,
  linked: count,
  first_shift_at: date.nullable(),
  first_confirmed_at: date.nullable(),
});
export const activationPageSchema = pageSchema(row).and(z.object({ generated_at: date }));
export type ActivationRow = z.infer<typeof row>;

export async function listActivation(offset: number) {
  const result = await supabase.rpc("admin_list_activation", { p_offset: offset });
  if (result.error) throw new Error(result.error.message);
  const value = activationPageSchema.safeParse(result.data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}

export type ActivationStep =
  | "venue"
  | "trial"
  | "people"
  | "email"
  | "shift"
  | "confirmed"
  | "active";

/** Il passo a cui l'azienda si è fermata, nell'ordine dei «Primi passi». */
export function activationStep(r: ActivationRow): ActivationStep {
  if (!r.first_venue_at) return "venue";
  if (!r.trial_started_at && r.state === "setup") return "trial";
  // Il titolare che lavora conta come una persona: serve almeno un altro.
  if (r.people <= 1) return "people";
  if (r.with_email <= 1) return "email";
  if (!r.first_shift_at) return "shift";
  if (!r.first_confirmed_at) return "confirmed";
  return "active";
}

export const ACTIVATION_STEP_LABEL: Record<ActivationStep, string> = {
  venue: "Senza sede",
  trial: "Prova da avviare",
  people: "Team vuoto",
  email: "Nessuna email",
  shift: "Nessun turno",
  confirmed: "Nessuna conferma",
  active: "Attiva",
};

/** Giorni interi fra due istanti, o `null` se manca il secondo. */
export function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000));
}
