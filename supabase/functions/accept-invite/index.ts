// Edge Function `accept-invite` — trasforma un token d'invito in un account.
//
// È l'altra metà di `invite-staff`: quella manda il link, questa lo spende. Il
// collaboratore atterra su `#/invito?t=<token>` senza sessione, la pagina chiede
// `peek` per sapere chi l'ha invitato e dove, e al submit chiede `accept`, che
// crea l'account con la password scelta in quel momento.
//
// ⚠️ **Perché l'account nasce qui e non all'invio.** Fino al 16/09 lo creava
// `generateLink({ type: 'invite' })` dentro `invite-staff`, e quella scelta
// costava due cose: l'indirizzo restava occupato anche per chi l'invito non lo
// apriva mai (e non poteva più registrarsi da nessuna parte), e aprire il link
// attivava l'accesso **prima** della password, lasciando dentro senza password
// chi abbandonava a metà. Creando l'account al submit spariscono entrambe:
// prima di quel momento non esiste nessun `auth.users`.
//
// ⚠️ **Questa function è pubblica** (`--no-verify-jwt`): chi la chiama un account
// non ce l'ha ancora, è il motivo per cui esiste. Cosa la tiene stretta:
//   - il body non contiene **mai** un indirizzo. Il token è l'unico input che
//     seleziona una riga, e l'email si legge da lì — stessa regola di
//     `invite-staff`, che senza di essa sarebbe un relay SMTP aperto;
//   - il token è di 32 byte casuali e nel database c'è solo il suo SHA-256;
//   - l'invito deve essere `pending`, non scaduto, non già speso: lo decidono
//     `claim_venue_access_invite` e `consume_venue_access_invite`, in SQL;
//   - la password è rivalidata qui, non ci si fida del form.
//
// Deploy (NIENTE JWT, a differenza di `invite-staff` e `delete-account`):
//   supabase functions deploy accept-invite --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // Vedi `delete-account`: senza `apikey` e `x-client-info` il browser blocca
  // la POST dopo un preflight riuscito. `authorization` resta anche se qui non
  // serve — `functions.invoke` lo manda comunque quando c'è una sessione.
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

/** `raise exception 'x'` arriva come messaggio: lo si rimappa sullo stato HTTP. */
const STATUS: Record<string, number> = {
  invite_not_found: 404,
  invite_expired: 410,
  invite_used: 409,
  already_linked: 409,
  no_email: 409,
};

function claimFailed(message: string) {
  const code = Object.keys(STATUS).find((k) => message.includes(k));
  return json({ error: code ?? "invite_not_found" }, code ? STATUS[code] : 404);
}

/**
 * Le stesse regole di `src/features/auth/schema.ts`, riscritte perché una Edge
 * Function non importa dal bundle dell'app.
 *
 * ⚠️ Rivalidare non è ridondanza: il form è il posto dove si spiegano le regole,
 * non dove si applicano. Qui arriva quello che il browser manda.
 */
function isPasswordValid(v: string): boolean {
  return (
    v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v)
  );
}

/** Quello che finisce nel database. Il token in chiaro non lo vede mai nessuno. */
async function sha256hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Invite = { email: string; owner_name: string; venue_name: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { op?: string; token?: string; password?: string; fullName?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const token = (body.token ?? "").trim();
  if (!token) return json({ error: "invite_not_found" }, 404);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const hash = await sha256hex(token);

  const { data, error } = await admin.rpc("claim_venue_access_invite", {
    p_hash: hash,
  });
  if (error) return claimFailed(error.message);

  const invite = (data as Invite[] | null)?.[0];
  if (!invite) return json({ error: "invite_not_found" }, 404);

  // Solo lettura: la pagina deve poter dire «X ti ha dato accesso a Y» prima di
  // chiedere una password a qualcuno che non sa ancora di cosa si tratta.
  // L'indirizzo torna indietro perché è quello a cui l'email è arrivata: chi ha
  // il token ce l'ha già sotto gli occhi.
  if (body.op === "peek") {
    return json({
      email: invite.email,
      ownerName: invite.owner_name,
      venueName: invite.venue_name,
    });
  }

  if (body.op !== "accept") return json({ error: "invalid op" }, 400);

  const password = body.password ?? "";
  if (!isPasswordValid(password)) return json({ error: "weak_password" }, 400);

  const fullName = (body.fullName ?? "").trim();

  // ⚠️ L'ordine: prima l'account, poi il token bruciato. Al contrario, una
  // creazione fallita si porterebbe via il token e lascerebbe la persona fuori
  // senza modo di rientrare. Così, nel caso peggiore (il consume fallisce dopo
  // la creazione) il token resta vivo ma l'account esiste: il secondo tentativo
  // cade su `email_taken`, che la pagina traduce in «accedi». Nessun vicolo cieco.
  //
  // `role: "manager"` è il punto di tutta la feature: `ensureProfile` legge il
  // ruolo da `user_metadata` e `link_venue_access_for_user` aggancia solo i
  // manager. Prima quella scelta la faceva l'invitato, in un menu, e sbagliarla
  // lasciava l'invito muto per sempre.
  //
  // `email_confirm: true` non salta la conferma: la registra. Il token è arrivato
  // solo in quella casella, quindi il possesso è già dimostrato — ed è la stessa
  // prova che dava il link GoTrue.
  const { error: createError } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { role: "manager", full_name: fullName || null },
  });

  if (createError) {
    const message = createError.message.toLowerCase();
    // Si è registrato da sé fra l'invito e adesso. L'accesso non è perso:
    // `claim_staff_invites()` lo aggancia al primo `SIGNED_IN`.
    if (message.includes("already") || message.includes("registered")) {
      return json({ error: "email_taken" }, 409);
    }
    return json({ error: "create_failed", detail: createError.message }, 502);
  }

  // Il token è speso. Se questa fallisce non si torna indietro: l'account c'è, e
  // rispondere con un errore su un'operazione riuscita manderebbe la persona a
  // ritentare per niente. Il token resterebbe spendibile una seconda volta, ma
  // la seconda volta trova l'email già presa e si ferma da sola.
  await admin.rpc("consume_venue_access_invite", { p_hash: hash });

  return json({ ok: true, email: invite.email });
});
