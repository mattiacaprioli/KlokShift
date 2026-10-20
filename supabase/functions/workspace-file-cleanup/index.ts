// Edge Function `workspace-file-cleanup` — toglie dallo Storage i file di
// un'azienda i cui dati il fondatore ha cancellato a fine archivio.
//
// `admin_delete_workspace_data` cancella le righe e mette in coda
// (`public.workspace_file_cleanup`) documenti del personale e loghi delle sedi:
// gli oggetti Storage non si cancellano da SQL. Questa funzione la svuota con
// l'API Storage, ed è la sola che la tocca.
//
// Solo il fondatore con secondo fattore: si verifica con `get_platform_admin_access`
// eseguita con il JWT del chiamante (allowlist, sessione viva, aal2), poi la
// coda si legge con la service role. Nessun path o messaggio Storage in risposta.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy workspace-file-cleanup --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { parseRequest, runCleanup, type BucketId, type StepResult } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // Vedi `delete-account`: senza `apikey` e `x-client-info` il browser blocca
  // la POST dopo un preflight riuscito.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const ok = <T>(value: T): StepResult<T> => ({ ok: true, value });
const failed = <T>(code: string): StepResult<T> => ({ ok: false, code });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "not_authenticated" }, 401);
  const { data: access, error: accessErr } = await asUser.rpc("get_platform_admin_access");
  if (accessErr || (access as { can_access?: unknown } | null)?.can_access !== true) {
    return json({ error: "admin_not_allowed" }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const request = parseRequest(body);
  if (!request) return json({ error: "invalid_request" }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const result = await runCleanup(request.workspaceId, {
    async listBatch(workspaceId, limit) {
      const { data, error } = await admin.from("workspace_file_cleanup")
        .select("id,bucket_id,object_name,attempts")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }).order("id", { ascending: true })
        .limit(limit);
      if (error) return failed("queue_read_failed");
      return ok((data ?? []).map((f) => ({
        id: f.id, bucketId: f.bucket_id as BucketId, objectName: f.object_name, attempts: f.attempts,
      })));
    },
    async removeObjects(bucketId, objectNames) {
      const { error } = await admin.storage.from(bucketId).remove(objectNames);
      return error ? failed("storage_remove_failed") : ok(undefined);
    },
    async markFailed(files, code) {
      const results = await Promise.all(files.map((f) =>
        admin.from("workspace_file_cleanup")
          // Codice nostro, mai il messaggio grezzo: può contenere nomi di file.
          .update({ attempts: f.attempts + 1, last_error_code: code }).eq("id", f.id)));
      return results.some((r) => r.error) ? failed("queue_mark_failed") : ok(undefined);
    },
    async clear(ids) {
      const { error } = await admin.from("workspace_file_cleanup").delete().in("id", ids);
      return error ? failed("queue_clear_failed") : ok(undefined);
    },
  });
  if (result.error) console.error("workspace-file-cleanup:", result.error);
  return json(result);
});
