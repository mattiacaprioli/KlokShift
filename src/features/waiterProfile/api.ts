import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export type Profile = Tables<"profiles">;
export type WaiterProfile = Tables<"waiter_profiles">;

export type ProfileWithWaiter = Profile & {
  waiter_profile: WaiterProfile | null;
};

export type WaiterProfileInput = {
  full_name: string;
  city: string | null;
  bio: string | null;
  primary_role: string | null;
  languages: string[];
  specializations: string | null;
  experience: string | null;
  /** Giorno e mese insieme, o `null`: l'anno non si salva (20260914160000). */
  birthday: { day: number; month: number } | null;
};

/**
 * Esempi mostrati come placeholder sotto il campo "ruolo principale". Il campo è
 * **testo libero**: era una lista chiusa finché coincideva con quella
 * dell'organico, ma i ruoli ora li scrive ogni sede per sé e nessun elenco
 * fisso potrebbe descrivere tutti. Qui è comunque una vetrina, non un dato che
 * deve combaciare con qualcosa.
 */
export const PRIMARY_ROLE_EXAMPLES = "Es. Cameriere, Barman, Chef de rang…";

/** Lingue parlate (scelta multipla). Lista curata → dati normalizzati e filtrabili. */
export const LANGUAGE_OPTIONS = [
  "Italiano",
  "Inglese",
  "Francese",
  "Spagnolo",
  "Tedesco",
  "Portoghese",
  "Arabo",
  "Cinese",
  "Rumeno",
  "Russo",
] as const;

/**
 * Un cameriere (profilo + waiter_profile) per id. Il ristoratore può leggerlo se
 * il cameriere si è candidato a un suo turno (RLS "manager sees applicant profiles").
 */
export async function getWaiterProfileById(
  waiterId: string
): Promise<ProfileWithWaiter | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*, waiter_profile:waiter_profiles(*)")
    .eq("id", waiterId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProfileWithWaiter | null) ?? null;
}

/** Il profilo del cameriere loggato (join 1:1 con waiter_profiles). */
export const getMyWaiterProfile = getWaiterProfileById;

/**
 * Persist the editable profile. Two non-transactional writes: the shared `profiles`
 * fields, then an upsert of the waiter-only `waiter_profiles` row (PK = user id).
 */
export async function saveWaiterProfile(
  userId: string,
  input: WaiterProfileInput
): Promise<void> {
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      city: input.city,
      bio: input.bio,
      // Le due colonne si scrivono sempre insieme: scriverne una sola violerebbe
      // `profiles_birthday_valid`, che è esattamente ciò che deve fare.
      birth_day: input.birthday?.day ?? null,
      birth_month: input.birthday?.month ?? null,
    })
    .eq("id", userId);
  if (profileError) throw new Error(profileError.message);

  const { error: waiterError } = await supabase.from("waiter_profiles").upsert({
    id: userId,
    primary_role: input.primary_role,
    languages: input.languages,
    specializations: input.specializations,
    experience: input.experience,
  });
  if (waiterError) throw new Error(waiterError.message);
}
