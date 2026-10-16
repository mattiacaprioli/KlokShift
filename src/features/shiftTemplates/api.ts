import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";
import {
  parseRoleTargets,
  type ShiftTemplateInput,
  type TemplateRoleTarget,
} from "./template";

export type ShiftTemplate = Omit<Tables<"shift_templates">, "role_targets"> & {
  role_targets: TemplateRoleTarget[];
};

/**
 * I modelli di una sede, per nome. Li legge chi ha «Turni» su quella sede (la
 * RLS): per gli altri la lista è vuota, non un errore.
 */
export async function getVenueShiftTemplates(
  venueId: string
): Promise<ShiftTemplate[]> {
  const { data, error } = await supabase
    .from("shift_templates")
    .select("*")
    .eq("venue_id", venueId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    role_targets: parseRoleTargets(row.role_targets),
  }));
}

/**
 * Salva un modello. Con un nome che la sede ha già (maiuscole e spazi a parte)
 * aggiorna quel modello invece di affiancargli un doppione.
 */
export async function saveShiftTemplate(
  venueId: string,
  input: ShiftTemplateInput
): Promise<string> {
  const { data, error } = await supabase.rpc("save_shift_template", {
    p_venue: venueId,
    p_template: input,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** I turni nati dal modello non cambiano: sono copie, non legami. */
export async function deleteShiftTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_shift_template", {
    p_template: templateId,
  });
  if (error) throw new Error(error.message);
}
