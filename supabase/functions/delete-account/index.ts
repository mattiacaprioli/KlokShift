// Edge Function `delete-account` — cancella l'account di chi la chiama.
//
// Requisito obbligatorio di Google Play (User Data policy) e Apple 5.1.1(v):
// se l'app permette di creare un account, deve permettere di cancellarlo.
//
// Flusso: si verifica il JWT del chiamante (nessun parametro con l'id, così
// nessuno può cancellare l'account di un altro), poi con la service_role si
// esegue `public.delete_account(uuid)` — che anonimizza il profilo e ripulisce i
// dati personali conservando lo storico altrui — e infine si rimuove l'utente da
// auth.users, che porta via email e credenziali.
//
// L'ordine conta: prima i dati, poi l'identità. Se si cancellasse prima
// l'utente, il JWT resterebbe valido ma `delete_account` girerebbe su un profilo
// che l'app non sa più a chi appartiene.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy delete-account --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2";

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

  // 1) I path dei file che ha caricato, PRIMA di cancellarne le righe: dopo la
  //    RPC non c'è più modo di sapere quali blob erano suoi, e resterebbero nel
  //    bucket documenti d'identità di un account che non esiste più.
  const { data: myDocs } = await admin
    .from("staff_documents")
    .select("storage_path")
    .eq("uploaded_by", userId);

  // 2) Dati: anonimizza il profilo, rimuove i dati personali, conserva lo
  //    storico che appartiene ad altri (ore dello staff, turni passati, thread).
  const { error: rpcErr } = await admin.rpc("delete_account", {
    p_user: userId,
  });
  if (rpcErr) return json({ error: rpcErr.message }, 500);

  // 3) I blob. Dopo la RPC di proposito: se fallisse a metà, meglio un file
  //    orfano che delle righe che puntano a file già spariti. Non blocca la
  //    cancellazione — l'account va comunque chiuso.
  const paths = (myDocs ?? []).map((d) => d.storage_path);
  if (paths.length > 0) {
    await admin.storage.from("staff-documents").remove(paths);
  }

  // 4) Identità: email e credenziali.
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ deleted: true });
});
