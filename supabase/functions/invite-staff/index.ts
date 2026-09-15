// Edge Function `invite-staff` — manda l'email d'invito a una persona che il
// titolare ha messo in organico ma che **non ha ancora un account**.
//
// Il ramo "persona già registrata" non passa di qui: quello resta
// `find_waiter_by_email` + invito in-app. Qui c'è il caso normale — il titolare
// ha l'email di Marco, Marco non sa nemmeno che topWaitr esiste.
//
// I due inviti non funzionano allo stesso modo, ed è voluto:
//
//   organico (`personId`)  → email con un link alla vetrina. La persona si
//                            registra da sé, e l'account resta suo: è il suo
//                            profilo di carriera, fra più aziende.
//   collaboratore (`team`) → l'account lo creiamo noi con `generateLink`, già
//                            `role: 'manager'`. Un collaboratore è un posto
//                            dentro l'azienda del titolare (non può possedere
//                            sedi), e la scelta del ruolo era il punto in cui
//                            l'invito si rompeva in silenzio.
//
// In entrambi i casi il body porta **solo** un id di riga, mai un indirizzo: per
// spedire a qualcuno il titolare deve prima averlo scritto su una propria
// scheda, dove l'unique (owner_id, email) e `invite_count` lo tengono sotto
// controllo. Senza questo vincolo la function sarebbe un relay SMTP aperto a
// chiunque abbia un account.
//
// Controlli, rate limit e incremento stanno tutti nelle RPC `claim_*`, in una
// transazione con `for update`: due tap sul bottone non producono due email.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy invite-staff --project-ref rmlobxjlqlpixkvrzmfg
//
// Secrets:
//   supabase secrets set SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... \
//     SMTP_PASS=... SMTP_FROM='topWaitr <no-reply@...>' SITE_URL='https://...' \
//     DASHBOARD_URL='https://.../app'
//
// ⚠️ `DASHBOARD_URL` è dove atterra il link del collaboratore, e va anche messo
// fra i "Redirect URLs" di Supabase Auth: senza, GoTrue rimanda al Site URL e
// l'invito finisce da nessuna parte.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SMTP_HOST = Deno.env.get("SMTP_HOST")!;
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "587");
const SMTP_USER = Deno.env.get("SMTP_USER")!;
const SMTP_PASS = Deno.env.get("SMTP_PASS")!;
const SMTP_FROM = Deno.env.get("SMTP_FROM")!;
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
/** La dashboard delle sedi: ci atterra il link d'invito del collaboratore. */
const DASHBOARD_URL = (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // Vedi `delete-account`: senza `apikey` e `x-client-info` il browser blocca
  // la POST dopo un preflight riuscito.
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
  not_owner: 403,
  already_linked: 403,
  no_email: 403,
  rate_limited: 429,
  // Stesso indirizzo invitato anche da un'altra azienda: il suo account non è
  // solo nostro e non si cancella (vedi `claim_venue_access_cancel`).
  invite_shared: 409,
};

function claimFailed(message: string) {
  const code = Object.keys(STATUS).find((k) => message.includes(k));
  return json({ error: code ?? "claim_failed" }, code ? STATUS[code] : 500);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Osteria del Borgo", "A e B", "A, B e C" — mai una lista con la virgola finale. */
function joinIt(names: string[]): string {
  if (names.length === 0) return "un locale";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

type Payload = {
  email: string;
  full_name: string;
  owner_name: string;
  venue_names: string[];
};

/** Il payload di `claim_venue_access_send`: una sede sola, nessun nome. */
type TeamPayload = {
  email: string;
  owner_name: string;
  venue_name: string;
};

function buildEmail(p: Payload) {
  const venue = joinIt(p.venue_names);
  // ⚠️ `invito.html` e non `/invito/`: la vetrina è statica su Pages, senza
  // fallback SPA, e l'entry sta alla radice (vedi `web-site/vite.config.mts`).
  // La cartella non esiste, e il link dell'invito finirebbe su un 404.
  const link = `${SITE_URL}/invito.html`;
  const firstName = p.full_name.trim().split(/\s+/)[0] || "ciao";

  const subject = `${venue} ti ha aggiunto al suo organico su topWaitr`;

  // Il testo semplice non è un di più: un'email solo-HTML, mandata a freddo a
  // qualcuno che non conosce il mittente, parte con un punteggio spam peggiore.
  const text = [
    `Ciao ${firstName},`,
    ``,
    `${p.owner_name} ti ha aggiunto all'organico di ${venue} su topWaitr,`,
    `l'app con cui il locale organizza i turni e tu tieni il conto delle tue ore.`,
    ``,
    `Scarica l'app: ${link}`,
    ``,
    `Registrati con questo indirizzo (${p.email}): è quello che ti collega alla`,
    `scheda che ${p.owner_name} ha già preparato.`,
    ``,
    `---`,
    `Ricevi questa email perché ${venue} ha inserito il tuo indirizzo nel proprio`,
    `organico su topWaitr. Se non ti riguarda, ignorala: senza registrazione non`,
    `viene creato nessun account.`,
    `Privacy: ${SITE_URL}/privacy.html`,
  ].join("\n");

  const e = {
    venue: escapeHtml(venue),
    owner: escapeHtml(p.owner_name),
    name: escapeHtml(firstName),
    email: escapeHtml(p.email),
  };

  const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#F5F2EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#23201B;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;">
<tr><td style="padding:32px 28px;">
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A8070;">topWaitr</p>
  <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;">Ti hanno aggiunto a un organico</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Ciao ${e.name}, <strong>${e.owner}</strong> ti ha aggiunto all'organico di <strong>${e.venue}</strong> su topWaitr — l'app con cui il locale organizza i turni e tu tieni il conto delle tue ore.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td style="border-radius:999px;background:#23201B;">
      <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Scarica l'app</a>
    </td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F2EC;border-radius:12px;">
    <tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;">
      Registrati con <strong>questo indirizzo</strong> (${e.email}): è quello che ti collega alla scheda che ${e.owner} ha già preparato.
    </td></tr>
  </table>
  <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #E6E0D6;font-size:12px;line-height:1.6;color:#8A8070;">
    Ricevi questa email perché ${e.venue} ha inserito il tuo indirizzo nel proprio organico su topWaitr. Se non ti riguarda, ignorala: senza registrazione non viene creato nessun account.<br>
    <a href="${SITE_URL}/privacy.html" style="color:#8A8070;">Privacy</a>
  </p>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * L'email del collaboratore.
 *
 * Testo diverso e non un parametro dentro `buildEmail`: chi riceve questa non
 * viene invitato a *lavorare* in una sede, ma a *gestirla*. E soprattutto non
 * deve registrarsi: l'accesso è già pronto, gli resta da dimostrare che quella
 * casella è sua — cioè aprire questo link, che è l'unica cosa che valorizza
 * `email_confirmed_at` e fa scattare l'aggancio.
 *
 * `link` arriva da fuori perché è un `action_link` monouso generato al momento,
 * non un indirizzo fisso: metterlo qui dentro vorrebbe dire ricostruirlo, e un
 * link d'invito ricostruito a mano non esiste.
 */
function buildTeamEmail(p: TeamPayload, link: string) {
  const subject = `${p.owner_name} ti ha dato accesso a ${p.venue_name} su topWaitr`;

  const text = [
    `Ciao,`,
    ``,
    `${p.owner_name} ti ha dato accesso alla gestione di ${p.venue_name} su`,
    `topWaitr: da lì organizzi i turni e segui l'organico della sede.`,
    ``,
    `L'accesso è già pronto a nome di questo indirizzo (${p.email}). Per entrare`,
    `apri questo link e scegli una password:`,
    ``,
    `${link}`,
    ``,
    `Il link vale 24 ore ed è usabile una volta sola. Se è scaduto, chiedi a`,
    `${p.owner_name} di rimandartelo.`,
    ``,
    `Con quella password entri sia da qui che dall'app topWaitr.`,
    ``,
    `---`,
    `Ricevi questa email perché ${p.owner_name} ti ha aggiunto ai collaboratori di`,
    `${p.venue_name} su topWaitr. Se non ti riguarda, ignorala: finché non apri il`,
    `link l'accesso non si attiva, e l'account resta inutilizzabile.`,
    `Privacy: ${SITE_URL}/privacy.html`,
  ].join("\n");

  const e = {
    venue: escapeHtml(p.venue_name),
    owner: escapeHtml(p.owner_name),
    email: escapeHtml(p.email),
  };

  const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#F5F2EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#23201B;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;">
<tr><td style="padding:32px 28px;">
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A8070;">topWaitr</p>
  <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;">Ti hanno dato accesso a una sede</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6;"><strong>${e.owner}</strong> ti ha dato accesso alla gestione di <strong>${e.venue}</strong> su topWaitr — da lì organizzi i turni e segui l'organico della sede.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td style="border-radius:999px;background:#23201B;">
      <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Attiva il tuo accesso</a>
    </td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F2EC;border-radius:12px;">
    <tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;">
      L'accesso è già pronto a nome di <strong>${e.email}</strong>: non devi registrarti, ti basta aprire il link e scegliere una password. Con quella entri sia da qui che dall'app.<br><br>
      Il link vale 24 ore ed è usabile una volta sola. Se è scaduto, chiedi a ${e.owner} di rimandartelo.
    </td></tr>
  </table>
  <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #E6E0D6;font-size:12px;line-height:1.6;color:#8A8070;">
    Ricevi questa email perché ${e.owner} ti ha aggiunto ai collaboratori di ${e.venue} su topWaitr. Se non ti riguarda, ignorala: finché non apri il link l'accesso non si attiva, e l'account resta inutilizzabile.<br>
    <a href="${SITE_URL}/privacy.html" style="color:#8A8070;">Privacy</a>
  </p>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * Il link con cui il collaboratore entra la prima volta.
 *
 * `generateLink` crea l'utente e torna l'`action_link` **senza spedire niente**:
 * l'email la manda questa function, con il proprio SMTP, il proprio copy e i
 * rate limit che ha già. Passare da `inviteUserByEmail` vorrebbe dire due
 * pipeline di posta e due mittenti.
 *
 * Il `role: 'manager'` nei metadati è il punto di tutta la feature: `profiles`
 * nasce da lì (`ensureProfile` in src/lib/auth.tsx) e `link_venue_access_for_user`
 * aggancia solo i manager. Prima quella scelta la faceva l'invitato, in un menu,
 * e sbagliarla lasciava l'invito muto per sempre.
 */
async function teamInviteLink(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<{ link: string } | { error: string; detail?: string }> {
  // L'invito precedente mai aperto va tolto di mezzo: `type: 'invite'` non si
  // può rigenerare su un utente che esiste. Sparisce solo se è ancora inerte —
  // la funzione SQL controlla email non confermata **e** nessun profilo.
  const { data: inert, error: inertError } = await admin.rpc("inert_invite_user", {
    p_email: email,
  });
  if (inertError) return { error: "invite_failed", detail: inertError.message };
  if (inert) {
    const { error } = await admin.auth.admin.deleteUser(inert as string);
    if (error) return { error: "invite_failed", detail: error.message };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { role: "manager" }, redirectTo: `${DASHBOARD_URL}/` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) {
    return { error: "invite_failed", detail: error?.message };
  }
  return { link };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // Chi sei: dal token, mai dal body.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "invalid token" }, 401);

  // Tre operazioni, una function: l'invito al collaboratore (`kind: "team"`),
  // la sua disdetta (`kind: "team_cancel"`) e l'invito alla persona in organico
  // (tutto il resto, incluse le versioni dell'app che il campo `kind` non lo
  // mandano). Stessa autenticazione, stessi rate limit, stesso SMTP — cambia il
  // destinatario e il testo.
  let body: { personId?: string; accessId?: string; kind?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Disdetta: il titolare ha revocato un invito che nessuno ha ancora aperto, e
  // l'`auth.users` creato per generarlo va tolto di mezzo — finché resta lì
  // quell'indirizzo è occupato e chi l'ha ricevuto per sbaglio non riesce più a
  // registrarsi. Non manda nessuna email, quindi non tocca i rate limit.
  if (body.kind === "team_cancel") {
    if (!body.accessId) return json({ error: "missing accessId" }, 400);

    const { data, error } = await admin.rpc("claim_venue_access_cancel", {
      p_access: body.accessId,
      p_owner: userData.user.id,
    });
    if (error) return claimFailed(error.message);

    const email = (data as { email: string }[] | null)?.[0]?.email;
    if (!email) return json({ error: "not_owner" }, 403);

    // Secondo controllo, su un'altra tabella: la RPC ha detto di chi è l'invito,
    // questa dice se l'account è ancora inerte. Nessuno dei due da solo basta.
    const { data: inert, error: inertError } = await admin.rpc("inert_invite_user", {
      p_email: email,
    });
    if (inertError) return json({ error: "delete_failed" }, 500);
    if (!inert) return json({ deleted: false });

    const { error: deleteError } = await admin.auth.admin.deleteUser(inert as string);
    if (deleteError) return json({ error: "delete_failed" }, 502);
    return json({ deleted: true });
  }

  const isTeam = body.kind === "team";
  const rowId = isTeam ? body.accessId : body.personId;
  if (!rowId) return json({ error: isTeam ? "missing accessId" : "missing personId" }, 400);

  // Proprietà, stato della riga, rate limit e incremento: tutto qui dentro.
  const { data, error } = isTeam
    ? await admin.rpc("claim_venue_access_send", {
        p_access: rowId,
        p_owner: userData.user.id,
      })
    : await admin.rpc("claim_staff_invite_send", {
        p_person: rowId,
        p_owner: userData.user.id,
      });
  if (error) return claimFailed(error.message);

  const payload = (data as (Payload | TeamPayload)[] | null)?.[0];
  if (!payload) return json({ error: "not_owner" }, 403);

  let mail: { subject: string; text: string; html: string };
  if (isTeam) {
    // Prima il link, poi la posta: un'email d'invito senza link funzionante è
    // peggio di un'email non spedita, perché il tentativo è già consumato e chi
    // la riceve non ha niente da cliccare.
    const invite = await teamInviteLink(admin, payload.email);
    if ("error" in invite) return json(invite, 502);
    mail = buildTeamEmail(payload as TeamPayload, invite.link);
  } else {
    mail = buildEmail(payload as Payload);
  }
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      // 465 è TLS implicito; su 587 si parte in chiaro e denomailer fa lui lo
      // STARTTLS. Invertirli è il modo più comune di ritrovarsi una function
      // che non spedisce e non dice perché.
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  try {
    await client.send({
      from: SMTP_FROM,
      to: payload.email,
      subject: mail.subject,
      content: mail.text,
      html: mail.html,
    });
  } catch (e) {
    // Il tentativo resta consumato di proposito: rimborsarlo aprirebbe un loop
    // di ritentativi contro un SMTP che sta già rifiutando. Il client dice di
    // riprovare tra qualche minuto.
    return json({ error: "smtp_failed", detail: String(e) }, 502);
  } finally {
    // Senza `close()` l'isolate resta appeso al socket e l'invocazione va in
    // timeout **pur avendo spedito**: l'utente vede un errore e reinvia.
    await client.close();
  }

  return json({ sent: true });
});
