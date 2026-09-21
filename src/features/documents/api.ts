import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

/**
 * Documenti di un **membro** dell'azienda: HACCP, contratto, visita medica,
 * patentino. Quello che una sede deve poter esibire in un'ispezione.
 *
 * Stanno sul membro (`workspace_members`, colonna `member_id`) e non sulla
 * singola sede: chi lavora in due sedi della stessa azienda li carica una volta,
 * e dimettersi da una delle due non li porta via. Il percorso nel bucket è
 * `<member_id>/<file>`.
 *
 * ⚠️ Questo file lo importa **anche la dashboard web**: niente Expo qui dentro.
 * La scelta del file sul telefono vive in `pickDocument.ts`, che è solo nativo.
 */

export const DOCUMENTS_BUCKET = "staff-documents";

/** Deve combaciare con `file_size_limit` del bucket (20260912130100). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Deve combaciare con `allowed_mime_types` del bucket. */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type StaffDocument = Tables<"staff_documents">;

/**
 * Il file già in byte, pronto per lo Storage. Stessa forma di `uploadAvatar`, e
 * per lo stesso motivo: su React Native un `Blob` da `fetch(uri)` si costruisce
 * senza errori e carica **0 byte** — l'oggetto viene accettato, la riga salvata,
 * e il documento risulta vuoto solo a chi prova ad aprirlo.
 */
export type DocumentFile = {
  bytes: Blob | ArrayBuffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type DocumentMeta = { name: string; expires_at: string | null };

/** I documenti di un membro, scadenze più vicine in cima. */
export async function getStaffDocuments(
  memberId: string
): Promise<StaffDocument[]> {
  const { data, error } = await supabase
    .from("staff_documents")
    .select("*")
    .eq("member_id", memberId)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Il path dentro il bucket. La prima cartella **deve** essere il membro
 * (`<member_id>/<file>`): è da lì che la policy su `storage.objects` ricava chi
 * può leggere il file, e il check sulla riga lo impone anche lì.
 *
 * Il suffisso casuale non è paranoia: `storage_path` è `unique` e due tap
 * ravvicinati cadono nello stesso millisecondo.
 */
function documentPath(memberId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${memberId}/${Date.now()}-${rand}.${ext}`;
}

async function uploadFile(path: string, file: DocumentFile): Promise<void> {
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file.bytes, {
      // Senza tipo esplicito un ArrayBuffer viene salvato come
      // application/octet-stream, che il bucket rifiuta.
      contentType: file.mimeType,
      upsert: false,
    });
  if (error) throw new Error(error.message);
}

/**
 * Prima il file, poi la riga. Se l'insert fallisce il file viene rimosso.
 *
 * L'ordine inverso lascerebbe in lista un documento che non si può aprire — un
 * errore visibile a ogni tap — invece di un file invisibile a tutti.
 */
export async function createStaffDocument(
  memberId: string,
  meta: DocumentMeta,
  file: DocumentFile
): Promise<StaffDocument> {
  const path = documentPath(memberId, file.fileName);
  await uploadFile(path, file);

  const { data, error } = await supabase
    .from("staff_documents")
    .insert({
      member_id: memberId,
      name: meta.name.trim(),
      expires_at: meta.expires_at,
      storage_path: path,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
    })
    .select("*")
    .single();

  if (error) {
    // Compensazione best-effort: se anche questa fallisce resta un file orfano,
    // invisibile nell'app e comunque coperto dalle policy della scheda.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return data;
}

export async function updateStaffDocument(
  id: string,
  meta: DocumentMeta
): Promise<void> {
  const { data, error } = await supabase
    .from("staff_documents")
    .update({ name: meta.name.trim(), expires_at: meta.expires_at })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  // Un update che la RLS scarta torna 204 senza errore: zero righe = non salvato.
  if (!data || data.length === 0) throw new Error("not_allowed");
}

/**
 * Sostituisce il file tenendo la riga. Il nuovo va su un path **nuovo**: un
 * `upsert` sullo stesso path, interrotto a metà, avrebbe già distrutto
 * l'originale. Prima la riga punta al file nuovo, poi si cancella il vecchio —
 * la stessa regola della foto profilo.
 */
export async function replaceStaffDocumentFile(
  doc: StaffDocument,
  file: DocumentFile
): Promise<void> {
  const path = documentPath(doc.member_id, file.fileName);
  await uploadFile(path, file);

  const { data, error } = await supabase
    .from("staff_documents")
    .update({
      storage_path: path,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
    })
    .eq("id", doc.id)
    .select("id");
  if (error || !data || data.length === 0) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw new Error(error?.message ?? "not_allowed");
  }

  await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
}

export async function deleteStaffDocument(doc: StaffDocument): Promise<void> {
  const { data, error } = await supabase
    .from("staff_documents")
    .delete()
    .eq("id", doc.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("not_allowed");
  // Best-effort, come per gli avatar: se fallisce resta un file che nessuno
  // raggiunge più, non una riga che punta al vuoto.
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
}

/**
 * L'URL con cui si apre un documento. Il bucket è privato, quindi non esiste un
 * `getPublicUrl`: ogni apertura è una chiamata di rete che può fallire.
 *
 * ⚠️ Una signed URL è un lasciapassare: chi ce l'ha entra, RLS o no. Dura **60
 * secondi** — il tempo di aprire il file, non di tenerlo aperto — e non va mai
 * messa in cache né in un log. Per questo chi la usa la chiede con una mutation
 * al momento del tap, non con una query al render.
 *
 * `download` forza il salvataggio col nome vero del documento invece del path.
 */
export async function createDocumentUrl(
  storagePath: string,
  opts?: { download?: string }
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60, opts);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
