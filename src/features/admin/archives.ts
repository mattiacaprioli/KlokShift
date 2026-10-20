import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { functionErrorCode } from "@/lib/functionError";
import { pageSchema } from "./types";

/*
 * Archivi scaduti nell'area fondatore: elenco con l'inventario di cosa si
 * cancellerebbe, cancellazione con il nome dell'azienda e pulizia dei file.
 * La decisione (scaduto, abbonamento chiuso) la prende il server.
 */

const id = z.string().uuid();
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const inventory = z.object({
  venues: count, shifts: count, assignments: count, clock_records: count, members: count,
  absences: count, documents: count, conversations: count, messages: count, notifications: count,
  files_pending: count,
});
const archive = z.object({
  workspace_id: id, workspace_name: z.string(),
  deleted_at: date.nullable(), data_deleted_at: date.nullable(),
  // Dal jsonb di workspace_access_at: istante in testo.
  archive_until: z.string().nullable(),
  subscription_open: z.boolean(), inventory,
});
export const expiredArchivesSchema = pageSchema(archive).and(z.object({ generated_at: date }));
const deletionResultSchema = z.object({
  workspace_id: id, data_deleted_at: date, deleted: inventory.omit({ files_pending: true }), files_pending: count,
});
const cleanupResultSchema = z.object({
  removed: count, failed: count, remaining: z.boolean(), error: z.string().optional(),
});

export type ExpiredArchive = z.infer<typeof archive>;
export type CleanupResult = z.infer<typeof cleanupResultSchema>;
export type DeleteWorkspaceData = { workspaceId: string; operationId: string; confirmName: string; reason: string };

function parsed<T extends z.ZodType>(schema: T, result: { data: unknown; error: { message: string } | null }): z.output<T> {
  if (result.error) throw new Error(result.error.message);
  const value = schema.safeParse(result.data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}

export async function listExpiredArchives(offset: number) {
  return parsed(expiredArchivesSchema, await supabase.rpc("admin_list_expired_archives", { p_offset: offset }));
}

export async function deleteWorkspaceData(c: DeleteWorkspaceData) {
  return parsed(deletionResultSchema, await supabase.rpc("admin_delete_workspace_data", {
    p_workspace: c.workspaceId, p_operation: c.operationId, p_confirm_name: c.confirmName, p_reason: c.reason,
  }));
}

/**
 * Cancella i dati e subito dopo prova a togliere i file. Se la pulizia non
 * riesce i file restano in coda (la cancellazione è già avvenuta) e si
 * ritentano dall'elenco: l'errore della pulizia non fa fallire l'operazione.
 */
export async function deleteWorkspaceDataAndFiles(c: DeleteWorkspaceData) {
  const deleted = await deleteWorkspaceData(c);
  const files = deleted.files_pending > 0
    ? await cleanupWorkspaceFiles(c.workspaceId).catch(() => null)
    : { removed: 0, failed: 0, remaining: false };
  return { deleted, files };
}

/** Toglie dallo Storage i file in coda di un'azienda già cancellata. */
export async function cleanupWorkspaceFiles(workspaceId: string) {
  const { data, error } = await supabase.functions.invoke("workspace-file-cleanup", { body: { workspaceId } });
  if (error) throw new Error((await functionErrorCode(error)) || "admin_cleanup_failed");
  const value = cleanupResultSchema.safeParse(data);
  if (!value.success) throw new Error("admin_response_invalid");
  return value.data;
}
