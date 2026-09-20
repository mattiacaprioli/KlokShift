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
 * Un professionista (profilo + waiter_profile) per id. `waiter_profile` è `null`
 * per chi non ha (ancora) un profilo professionale: si crea dal wizard o dalla
 * modifica del profilo. La lettura da parte di una sede la decide la RLS.
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
 * Scrive la riga di `waiter_profiles` della persona in sessione, creandola se non
 * c'è. Unico punto da cui passa quella tabella: la usano sia il wizard di
 * onboarding sia la modifica del profilo.
 *
 * ⚠️ **Niente `.upsert({ id, … })`**. PostgREST traduce l'upsert in
 * `insert … on conflict (id) do update set id = excluded.id, …`: mette in SET
 * **ogni** colonna del payload, `id` compreso. Ma l'UPDATE su questa tabella è
 * concesso per colonna e `id` non è nell'elenco (la chiave non si riscrive, come
 * `rating_*` che li tiene il trigger), quindi il comando muore con
 * `42501 permission denied for table waiter_profiles` — anche quando la riga non
 * esiste ancora, perché il permesso si controlla prima di sapere se ci sarà un
 * conflitto. Due passaggi allora: la riga (senza toccarla se c'è già) e poi i
 * campi.
 */
export async function writeWaiterProfile(
  userId: string,
  fields: Partial<WaiterProfile>
): Promise<void> {
  // `ignoreDuplicates` → `on conflict do nothing`: serve solo l'INSERT, e chi ha
  // già la riga non se la vede riscritta.
  const { error: rowError } = await supabase
    .from("waiter_profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (rowError) throw new Error(rowError.message);

  // `.select()`: un UPDATE che la RLS scarta torna 204 senza errore, e zero righe
  // qui vuol dire che non abbiamo scritto niente.
  const { data, error } = await supabase
    .from("waiter_profiles")
    .update(fields)
    .eq("id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("profile_not_saved");
}

/**
 * Persist the editable profile. Two non-transactional writes: the shared `profiles`
 * fields, then the waiter-only `waiter_profiles` row (PK = user id).
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

  await writeWaiterProfile(userId, {
    primary_role: input.primary_role,
    languages: input.languages,
    specializations: input.specializations,
    experience: input.experience,
  });
}
