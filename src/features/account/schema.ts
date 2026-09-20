import { z } from "zod";

/**
 * I campi del proprio account che valgono per **qualunque** ruolo. Il
 * professionista ne ha qualcuno in più (città, ruolo, lingue): quelli stanno in
 * `waiterProfileSchema`, che scrive anche `waiter_profiles`.
 */
export const accountSchema = z.object({
  full_name: z.string().trim().min(1, "Inserisci il tuo nome."),
});

export type AccountForm = z.infer<typeof accountSchema>;
