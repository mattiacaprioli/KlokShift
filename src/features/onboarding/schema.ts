import { z } from "zod";

/**
 * Setup del profilo dipendente: solo il nome (la foto si carica a parte).
 * Città e ruolo principale non si chiedono più dal 22/10/2026: la sede non li
 * vede da nessuna parte, e restano modificabili dal profilo.
 */
export const onboardingSchema = z.object({
  full_name: z.string().trim().min(1, "Inserisci il tuo nome."),
});

export type OnboardingForm = z.infer<typeof onboardingSchema>;
