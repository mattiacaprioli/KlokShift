import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Inserisci un'email valida."),
  password: z.string().min(1, "Inserisci la password."),
});

// Regole password allineate a Supabase Auth (Minimum length 8 + requirement
// "Lowercase, uppercase letters and digits"). Classi ASCII per combaciare con
// GoTrue: evita che il client accetti una password che il server rifiuterebbe.
// Unica fonte di verità, condivisa da signupSchema e da PasswordChecklist.
export const passwordRules = [
  { label: "Almeno 8 caratteri", test: (v: string) => v.length >= 8 },
  { label: "Una lettera minuscola", test: (v: string) => /[a-z]/.test(v) },
  { label: "Una lettera maiuscola", test: (v: string) => /[A-Z]/.test(v) },
  { label: "Un numero", test: (v: string) => /[0-9]/.test(v) },
] as const;

export const isPasswordValid = (v: string): boolean =>
  passwordRules.every((rule) => rule.test(v));

/** Il messaggio delle due password diverse, uguale ovunque le si chieda due volte. */
export const passwordMismatchMessage = "Le due password non coincidono.";

// Il ruolo si sceglie in una schermata dedicata e arriva come parametro di rotta,
// quindi qui restano solo le credenziali.
//
// La password si scrive due volte come su `Invito.tsx` e `NuovaPassword.tsx`: si
// digita alla cieca, e un refuso qui costa un account con una password che
// nessuno conosce — recuperabile solo dall'email di reset.
export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Inserisci il tuo nome."),
    email: z.string().trim().email("Inserisci un'email valida."),
    password: z
      .string()
      .refine(isPasswordValid, "La password non rispetta i requisiti indicati."),
    confirmPassword: z.string().min(1, "Ripeti la password."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: passwordMismatchMessage,
    path: ["confirmPassword"],
  });

export type LoginForm = z.infer<typeof loginSchema>;
export type SignupForm = z.infer<typeof signupSchema>;
