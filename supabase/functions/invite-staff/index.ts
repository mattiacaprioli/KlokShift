// Edge Function `invite-staff` — manda l'email d'invito a una persona che il
// titolare ha messo in organico ma che **non ha ancora un account**.
//
// Il ramo "persona già registrata" non passa di qui: quello resta
// `find_waiter_by_email` + invito in-app. Qui c'è il caso normale — il titolare
// ha l'email di Marco, Marco non sa nemmeno che topWaitr esiste.
//
// Il body porta **solo** `personId`, mai un indirizzo: per spedire a qualcuno il
// titolare deve prima averlo scritto su una propria scheda, dove l'unique
// (owner_id, email) e `invite_count` lo tengono sotto controllo. Senza questo
// vincolo la function sarebbe un relay SMTP aperto a chiunque abbia un account.
//
// Controlli, rate limit e incremento stanno tutti nella RPC
// `claim_staff_invite_send`, in una transazione con `for update`: due tap sul
// bottone non producono due email.
//
// Deploy (richiede JWT, quindi NIENTE --no-verify-jwt):
//   supabase functions deploy invite-staff --project-ref rmlobxjlqlpixkvrzmfg
//
// Secrets:
//   supabase secrets set SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... \
//     SMTP_PASS=... SMTP_FROM='topWaitr <no-reply@...>' SITE_URL='https://...'

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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
};

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
 * viene invitato a *lavorare* in un locale, ma a *gestirlo*. Deve registrarsi
 * come locale, non come professionista — ed è l'unica frase che, sbagliata,
 * rende l'invito inutilizzabile (l'aggancio richiede `role = 'manager'`).
 */
function buildTeamEmail(p: TeamPayload) {
  // Stessa pagina, altro copy: `?r=gestione` non autorizza niente, sceglie il
  // testo. Chi arriva qui deve registrarsi come **locale**.
  const link = `${SITE_URL}/invito.html?r=gestione`;
  const subject = `${p.owner_name} ti ha dato accesso a ${p.venue_name} su topWaitr`;

  const text = [
    `Ciao,`,
    ``,
    `${p.owner_name} ti ha dato accesso alla gestione di ${p.venue_name} su`,
    `topWaitr: da lì organizzi i turni e segui l'organico del locale.`,
    ``,
    `Scarica l'app: ${link}`,
    ``,
    `Registrati con questo indirizzo (${p.email}) scegliendo "Gestisco un locale":`,
    `è così che il tuo account si collega all'accesso già pronto.`,
    ``,
    `---`,
    `Ricevi questa email perché ${p.owner_name} ti ha aggiunto ai collaboratori di`,
    `${p.venue_name} su topWaitr. Se non ti riguarda, ignorala: senza registrazione`,
    `non viene creato nessun account.`,
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
  <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:700;">Ti hanno dato accesso a un locale</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6;"><strong>${e.owner}</strong> ti ha dato accesso alla gestione di <strong>${e.venue}</strong> su topWaitr — da lì organizzi i turni e segui l'organico del locale.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td style="border-radius:999px;background:#23201B;">
      <a href="${link}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">Scarica l'app</a>
    </td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F2EC;border-radius:12px;">
    <tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;">
      Registrati con <strong>questo indirizzo</strong> (${e.email}) scegliendo <strong>"Gestisco un locale"</strong>: è così che il tuo account si collega all'accesso già pronto.
    </td></tr>
  </table>
  <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #E6E0D6;font-size:12px;line-height:1.6;color:#8A8070;">
    Ricevi questa email perché ${e.owner} ti ha aggiunto ai collaboratori di ${e.venue} su topWaitr. Se non ti riguarda, ignorala: senza registrazione non viene creato nessun account.<br>
    <a href="${SITE_URL}/privacy.html" style="color:#8A8070;">Privacy</a>
  </p>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
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

  // Due inviti, una function: il collaboratore (`kind: "team"`) e la persona in
  // organico (tutto il resto, incluse le versioni dell'app che il campo `kind`
  // non lo mandano). Stessa autenticazione, stessi rate limit, stesso SMTP —
  // cambia il destinatario e il testo.
  let body: { personId?: string; accessId?: string; kind?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const isTeam = body.kind === "team";
  const rowId = isTeam ? body.accessId : body.personId;
  if (!rowId) return json({ error: isTeam ? "missing accessId" : "missing personId" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
  if (error) {
    const code = Object.keys(STATUS).find((k) => error.message.includes(k));
    return json({ error: code ?? "claim_failed" }, code ? STATUS[code] : 500);
  }

  const payload = (data as (Payload | TeamPayload)[] | null)?.[0];
  if (!payload) return json({ error: "not_owner" }, 403);

  const mail = isTeam
    ? buildTeamEmail(payload as TeamPayload)
    : buildEmail(payload as Payload);
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
