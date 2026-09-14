import { z } from "zod";

export const waiterProfileSchema = z.object({
  full_name: z.string().trim().min(1, "Inserisci il tuo nome."),
  city: z.string().trim(),
  bio: z.string().trim().max(180, "Massimo 180 caratteri."),
  primary_role: z.string().trim(),
  languages: z.array(z.string()),
  specializations: z.string().trim(),
  experience: z.string().trim(),
  /**
   * Giorno e mese insieme, o niente: è la stessa regola del CHECK
   * `profiles_birthday_valid`, perché un mese senza giorno non è una data
   * parziale ma una riga da cui l'interfaccia non sa che scrivere.
   */
  birthday: z
    .object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12) })
    .nullable(),
});

export type WaiterProfileForm = z.infer<typeof waiterProfileSchema>;
