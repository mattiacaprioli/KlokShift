import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";

/** Bucket pubblico delle foto profilo (migration 20260911130000). */
export const AVATARS_BUCKET = "avatars";

/**
 * I campi del proprio profilo modificabili da qualunque ruolo. Il cameriere ne
 * ha qualcuno in più (città, ruolo, lingue): quelli stanno in
 * `saveWaiterProfile`, che scrive anche `waiter_profiles`.
 */
export async function updateMyProfile(
  userId: string,
  input: { full_name?: string; avatar_url?: string | null }
): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update(input)
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Profilo non aggiornato.");
}

/**
 * Il professionista lascia una sede in cui è in organico (`leave`): si dimette
 * da quel posto di lavoro, non dall'azienda. I suoi turni futuri lì vengono
 * tolti dal server.
 */
export async function leaveVenue(
  memberId: string,
  venueId: string
): Promise<void> {
  const { error } = await supabase.rpc("leave", {
    p_member: memberId,
    p_venue: venueId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Carica la foto profilo e restituisce l'URL pubblico da mettere in
 * `profiles.avatar_url`.
 *
 * Nome nuovo a ogni caricamento invece di un percorso fisso con `upsert`: con
 * l'URL identico, browser e CDN continuerebbero a servire la foto vecchia. Chi
 * chiama cancella poi la precedente con `deleteAvatarByUrl`.
 *
 * Prende i byte e non un percorso, così vale per entrambi i client: il web
 * passa il `File` dell'input, l'app l'`ArrayBuffer` letto dal file scelto
 * (`new File(uri).arrayBuffer()`, come già fa `uploadCertification`). Un `Blob`
 * costruito da un `uri` con `fetch` su React Native caricherebbe **0 byte**.
 */
export async function uploadAvatar(
  userId: string,
  file: Blob | ArrayBuffer,
  { ext = "jpg", contentType }: { ext?: string; contentType?: string } = {}
): Promise<string> {
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, {
      contentType:
        contentType ||
        (file instanceof Blob && file.type ? file.type : "image/jpeg"),
      upsert: false,
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Percorso dentro il bucket a partire dall'URL pubblico. Null se non è nostro. */
function avatarPathFromUrl(url: string | null | undefined): string | null {
  const marker = `/${AVATARS_BUCKET}/`;
  const at = url?.indexOf(marker) ?? -1;
  if (!url || at < 0) return null;
  return url.slice(at + marker.length).split("?")[0];
}

/**
 * Toglie dal bucket la foto che non serve più. Best-effort di proposito: se
 * fallisce resta un file orfano da qualche parte, ma il profilo è già
 * aggiornato e non è un motivo per mostrare un errore a chi ha appena
 * cambiato la foto. La RLS limita comunque la cancellazione ai propri file.
 */
export async function deleteAvatarByUrl(
  url: string | null | undefined
): Promise<void> {
  const path = avatarPathFromUrl(url);
  if (!path) return;
  await supabase.storage.from(AVATARS_BUCKET).remove([path]);
}

/**
 * Cancella l'account di chi è loggato.
 *
 * Passa dalla Edge Function `delete-account` e non da una RPC diretta perché
 * servono i poteri di service_role per rimuovere la riga da `auth.users`
 * (email e credenziali), cosa che il client non può fare. La function ricava
 * l'utente dal JWT, quindi non c'è alcun id da passare — e nessun modo di
 * cancellare l'account di qualcun altro.
 */
export async function deleteMyAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<
    | { deleted: true; retryable: false }
    | { deleted: false; retryable: true; error: string }
  >("delete-account", { method: "POST" });
  if (error) throw new Error(error.message);
  if (data?.deleted) return;
  if (data?.retryable) {
    throw new UserFacingError(
      "La cancellazione non è ancora completa. Riprova: i file rimasti verranno controllati senza duplicare l’operazione."
    );
  }
  throw new Error("Cancellazione non riuscita");
}
