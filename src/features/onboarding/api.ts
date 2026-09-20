import { supabase } from "@/lib/supabase";
import {
  PRIMARY_ROLE_EXAMPLES,
  writeWaiterProfile,
} from "@/features/waiterProfile/api";

/** Ruolo principale — testo libero, stessi esempi del profilo cameriere. */
export { PRIMARY_ROLE_EXAMPLES };

export type OnboardingInput = {
  full_name: string;
  city: string | null;
  primary_role: string;
};

/**
 * Chiude l'onboarding: scrive `waiter_profiles` (scrittura parziale — le colonne
 * non elencate, languages, experience…, restano intatte) e poi i campi condivisi
 * di `profiles`, alzando il flag `onboarding_complete`.
 *
 * ⚠️ **L'ordine conta, ed è questo.** Le due scritture non sono in transazione:
 * alzando il flag per primo, un errore sulla seconda lasciava un account già
 * «onboardato» sul database ma fermo sul wizard nell'app — e chi riprovava
 * ripeteva l'errore senza avanzare mai. Il flag è l'ultima cosa che si scrive,
 * così vale quello che dice: il profilo c'è davvero.
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput
): Promise<void> {
  await writeWaiterProfile(userId, { primary_role: input.primary_role });

  // `.select()`: un UPDATE scartato dalla RLS tornerebbe 204 senza errore, e
  // proseguire lascerebbe l'utente sul wizard a ogni avvio.
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      city: input.city,
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
