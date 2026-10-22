import { supabase } from "@/lib/supabase";

export type OnboardingInput = {
  full_name: string;
};

/**
 * Chiude l'onboarding: il nome e il flag `onboarding_complete`, in una sola
 * scrittura su `profiles`.
 *
 * Fino al 22/10/2026 scriveva prima `waiter_profiles` (ruolo principale) e il
 * flag per ultimo, perché le due scritture non erano in transazione. Ora è una
 * sola: `waiter_profiles` resta com'è e si compila, se serve, dal profilo.
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput
): Promise<void> {
  // `.select()`: un UPDATE scartato dalla RLS tornerebbe 204 senza errore, e
  // proseguire lascerebbe l'utente sul wizard a ogni avvio.
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      onboarding_complete: true,
    })
    .eq("id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("profile_not_saved");
}

/**
 * Segna che l'utente ha visto l'intro di primo utilizzo (carosello di valore).
 * Distinto da `onboarding_complete` (wizard di setup profilo del cameriere).
 * La RLS "profiles: own read/write" (id = auth.uid()) consente l'update.
 */
export async function markIntroSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ intro_seen: true })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
