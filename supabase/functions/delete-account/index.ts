// Edge Function `delete-account` — cancella l'account di chi la chiama.
//
// Requisito obbligatorio di Google Play (User Data policy) e Apple 5.1.1(v):
// se l'app permette di creare un account, deve permettere di cancellarlo.
//
// Flusso: si verifica il JWT del chiamante (nessun parametro con l'id, così
// nessuno può cancellare l'account di un altro), poi con la service_role si
// accodano gli avatar e si esegue `public.delete_account(uuid)`. La RPC accoda
// atomicamente i documenti prima di eliminarne i metadati e anonimizza il
// profilo conservando lo storico altrui. La coda viene svuotata tramite le API
// Storage e soltanto alla fine si rimuove l'utente da auth.users.
//
// L'ordine conta: i riferimenti persistono finché Storage non conferma la
// rimozione. Se un passo fallisce, Auth resta attivo e la stessa richiesta può
// riprendere la coda in modo idempotente senza perdere i path.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy delete-account --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  runDeleteAccount,
  type FileRef,
  type StepResult,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // `apikey` e `x-client-info` li aggiunge supabase-js da sé a ogni richiesta:
  // se non sono in allowlist il browser annulla la POST subito dopo un
  // preflight riuscito, e dall'app non si vede perché fetch nativo non fa
  // preflight. Sintomo: OPTIONS 200 nei log, POST mai arrivata.
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function ok<T>(value: T): StepResult<T> {
  return { ok: true, value };
}

function failed<T>(code: string): StepResult<T> {
  return { ok: false, code };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // Chi sei: si legge dal token, mai dal body.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "invalid token" }, 401);

  const userId = userData.user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const result = await runDeleteAccount(userId, {
    async listAvatarPage(id, offset, limit) {
      const { data, error } = await admin.storage.from("avatars").list(id, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) return failed("avatar_list_failed");
      // Le cartelle virtuali non hanno `id`; sotto `<userId>/` interessano solo
      // gli oggetti veri. Il path completo viene composto dalla logica comune.
      return ok((data ?? []).filter((item) => !!item.id).map((item) => item.name));
    },

    async enqueueFiles(id, files) {
      const { error } = await admin.from("account_file_cleanup").upsert(
        files.map((file: FileRef) => ({
          user_id: id,
          bucket_id: file.bucketId,
          object_name: file.objectName,
        })),
        {
          onConflict: "user_id,bucket_id,object_name",
          ignoreDuplicates: true,
        }
      );
      return error ? failed("queue_write_failed") : ok(undefined);
    },

    async deleteAccountData(id) {
      const { error } = await admin.rpc("delete_account", { p_user: id });
      return error ? failed("delete_account_failed") : ok(undefined);
    },

    async listCleanupBatch(id, limit) {
      const { data, error } = await admin
        .from("account_file_cleanup")
        .select("id,bucket_id,object_name,attempts")
        .eq("user_id", id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) return failed("queue_read_failed");
      return ok(
        (data ?? []).map((file) => ({
          id: file.id,
          bucketId: file.bucket_id as FileRef["bucketId"],
          objectName: file.object_name,
          attempts: file.attempts,
        }))
      );
    },

    async removeObjects(bucketId, objectNames) {
      const { error } = await admin.storage.from(bucketId).remove(objectNames);
      return error ? failed("storage_remove_failed") : ok(undefined);
    },

    async markCleanupFailed(files, code) {
      const results = await Promise.all(
        files.map((file) =>
          admin
            .from("account_file_cleanup")
            .update({
              attempts: file.attempts + 1,
              // Codice nostro e privo di path/dati documento; non salviamo il
              // messaggio grezzo perché può contenere nomi sensibili.
              last_error_code: code,
            })
            .eq("id", file.id)
        )
      );
      return results.some((result) => result.error)
        ? failed("queue_mark_failed")
        : ok(undefined);
    },

    async clearCleanup(ids) {
      const { error } = await admin
        .from("account_file_cleanup")
        .delete()
        .in("id", ids);
      return error ? failed("queue_clear_failed") : ok(undefined);
    },

    async deleteAuthUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      return error ? failed("auth_delete_failed") : ok(undefined);
    },
  });

  // `deleted: false` significa che Auth esiste ancora e la stessa richiesta è
  // sicura da ritentare. Nessun token, path o messaggio Storage viene esposto.
  // È una risposta applicativa, anche quando chiede retry: così il client può
  // distinguere «account ancora presente» da un errore di trasporto opaco.
  return json(result);
});
