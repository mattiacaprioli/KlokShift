import { z } from "zod";
import type { Experience, ExperienceInput } from "./api";

const currentYear = new Date().getFullYear();

export const experienceSchema = z
  .object({
    company_name: z.string().trim().min(1, "Inserisci il nome della sede"),
    role: z.string().trim(),
    start_year: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Anno non valido")
      .refine(
        (v) => +v >= 1950 && +v <= currentYear,
        `Inserisci un anno tra 1950 e ${currentYear}`
      ),
    present: z.boolean(),
    end_year: z.string().trim(),
    detail: z.string().trim(),
  })
  .refine((d) => d.present || /^\d{4}$/.test(d.end_year), {
    path: ["end_year"],
    message: "Inserisci l'anno di fine o attiva OGGI",
  })
  .refine((d) => d.present || !d.end_year || +d.end_year >= +d.start_year, {
    path: ["end_year"],
    message: "La fine dev'essere maggiore o uguale all'inizio",
  });

export type ExperienceForm = z.infer<typeof experienceSchema>;

/** Valori di default per una nuova esperienza. */
export const emptyExperienceForm: ExperienceForm = {
  company_name: "",
  role: "",
  start_year: "",
  present: false,
  end_year: "",
  detail: "",
};

/** Form (stringhe) → payload DB. Stringhe vuote → null; anni → numero. */
export function formToInput(v: ExperienceForm): ExperienceInput {
  return {
    company_name: v.company_name.trim(),
    role: v.role.trim() || null,
    start_year: v.start_year ? Number(v.start_year) : null,
    end_year: v.present ? null : v.end_year ? Number(v.end_year) : null,
    detail: v.detail.trim() || null,
  };
}

/** Record DB → valori del form. end_year null ⇒ "OGGI" (present). */
export function experienceToForm(e: Experience): ExperienceForm {
  return {
    company_name: e.company_name,
    role: e.role ?? "",
    start_year: e.start_year != null ? String(e.start_year) : "",
    present: e.end_year == null,
    end_year: e.end_year != null ? String(e.end_year) : "",
    detail: e.detail ?? "",
  };
}
