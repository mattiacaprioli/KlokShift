import { z } from "zod";
import { SHIFT_RANGE_ERROR, isValidShiftRange } from "@/lib/format";

/**
 * Schema del turno interno lato web.
 *
 * Non riusa `src/features/shifts/schema.ts` di proposito: quello è modellato sui
 * picker di React Native e porta `date`/`start`/`end` come oggetti `Date`, mentre
 * `<input type="date">` e `<input type="time">` restituiscono già stringhe nel
 * formato delle colonne DB. Convertirle avanti e indietro aggiungerebbe solo
 * superficie d'errore. L'invariante che conta è la stessa, con lo stesso
 * messaggio, e sta in `isValidShiftRange`: la fine **non** deve essere dopo
 * l'inizio, perché un turno notturno finisce il giorno dopo.
 *
 * Convenzione di ARCHITECTURE.md rispettata: niente `.default()` qui, i valori
 * iniziali stanno nei defaultValues del form.
 */
export const internalShiftSchema = z
  .object({
    /**
     * La sede del turno. Dal 14/09/2026 è **un campo del form** e non più il
     * contesto in cui il form vive: non si entra in un locale per creare i suoi
     * turni, si crea un turno e si dice dove.
     */
    venue_id: z.string().uuid("Scegli una sede."),
    title: z.string().trim().min(1, "Inserisci un titolo per il turno."),
    date: z.string().min(1, "Scegli la data."),
    start_time: z.string().min(1, "Scegli l'orario di inizio."),
    end_time: z.string().min(1, "Scegli l'orario di fine."),
    description: z.string().trim(),
  })
  .refine((v) => isValidShiftRange(v.start_time, v.end_time), {
    message: SHIFT_RANGE_ERROR,
    path: ["end_time"],
  });

export type InternalShiftForm = z.infer<typeof internalShiftSchema>;
