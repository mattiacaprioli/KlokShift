import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import type { Tables } from "@/types/database";

/**
 * I collaboratori del titolare: chi altro entra nell'account, su quali sedi e
 * con quali permessi.
 *
 * Una riga per **(sede, persona)**. Il titolare non ha righe qui: `venues
 * .owner_id` resta la fonte di verità del "può tutto", e questa tabella non può
 * dare a nessuno più di quello.
 *
 * ⚠️ Nessun import di Expo o di React Native: la dashboard web riusa questo file.
 */
export type VenueAccess = Tables<"venue_access">;

/** Le aree di permesso, nell'ordine in cui compaiono nella UI. */
export const TEAM_PERMISSIONS = [
  "can_manage_shifts",
  "can_manage_staff",
  "can_view_hours",
  "can_manage_documents",
  "can_manage_venue",
] as const;

export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export const TEAM_PERMISSION_LABEL: Record<TeamPermission, string> = {
  can_manage_shifts: "Turni",
  can_manage_staff: "Organico",
  can_view_hours: "Ore ed export",
  can_manage_documents: "Documenti",
  can_manage_venue: "Dati della sede",
};

export const TEAM_PERMISSION_HINT: Record<TeamPermission, string> = {
  can_manage_shifts: "Crea, modifica e assegna i turni della sede",
  can_manage_staff: "Aggiunge persone alla sede e assegna le mansioni",
  can_view_hours: "Vede le ore lavorate e scarica gli export",
  can_manage_documents: "Vede e carica HACCP, contratti e scadenze",
  can_manage_venue: "Modifica i dati della sede e l'elenco delle mansioni",
};

export type TeamPermissions = Record<TeamPermission, boolean>;

/**
 * Una persona, con tutte le sedi su cui ha accesso.
 *
 * La UI ragiona per persona ("chi entra nel mio account"), il DB per sede
 * (è lì che serve al momento del controllo): l'aggregazione sta qui, una volta,
 * invece che in ogni schermata.
 */
export type TeamMember = {
  /** L'account, se la persona si è registrata. Altrimenti `null`. */
  userId: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** `pending` finché non c'è un account collegato. */
  status: "pending" | "active" | "revoked";
  /** Le righe `venue_access`, una per sede. */
  rows: VenueAccess[];
  venueIds: string[];
  invitedAt: string | null;
  inviteCount: number;
};

export function permissionsOf(row: VenueAccess): TeamPermissions {
  return {
    can_manage_shifts: row.can_manage_shifts,
    can_manage_staff: row.can_manage_staff,
    can_view_hours: row.can_view_hours,
    can_manage_documents: row.can_manage_documents,
    can_manage_venue: row.can_manage_venue,
  };
}

/**
 * I permessi di una persona **su tutte le sue sedi**: `null` quando divergono,
 * così la UI può dire "dipende dalla sede" invece di mostrare il valore della
 * prima riga come se fosse l'unico.
 *
 * Stessa forma di `personEmploymentType` in `features/staff/api.ts`.
 */
export function memberPermissions(
  member: TeamMember
): Partial<Record<TeamPermission, boolean | null>> {
  const out: Partial<Record<TeamPermission, boolean | null>> = {};
  for (const perm of TEAM_PERMISSIONS) {
    const first = member.rows[0]?.[perm] ?? false;
    out[perm] = member.rows.every((r) => r[perm] === first) ? first : null;
  }
  return out;
}

/** Chiave di raggruppamento: l'account se c'è, altrimenti l'indirizzo. */
function memberKey(row: VenueAccess): string {
  return row.user_id ?? `email:${(row.email ?? "").toLowerCase()}`;
}

/**
 * I collaboratori del titolare, raggruppati per persona.
 *
 * Le righe revocate non tornano: una revoca è una porta chiusa, non uno stato da
 * consultare. Restano in tabella perché `venue_access_notify` ha già avvisato la
 * persona e perché riaprire l'accesso è un `update`, non un nuovo invito.
 */
export async function getTeam(ownerId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("venue_access")
    .select("*")
    .eq("owner_id", ownerId)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];

  // I nomi stanno in `profiles`, non qui: la riga di accesso porta l'indirizzo
  // dell'invito, che dopo la registrazione può non essere più come si chiama.
  const names = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds);
    if (profErr) throw new Error(profErr.message);
    for (const p of profiles ?? []) {
      names.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
    }
  }

  const byKey = new Map<string, TeamMember>();
  for (const row of rows) {
    const key = memberKey(row);
    const found = byKey.get(key);
    if (found) {
      found.rows.push(row);
      found.venueIds.push(row.venue_id);
      if (row.status === "active") found.status = "active";
      // Il più recente dei due: è quello che decide se il pulsante "Reinvia" è
      // ancora bloccato dal rate limit.
      if (row.invited_at && (!found.invitedAt || row.invited_at > found.invitedAt)) {
        found.invitedAt = row.invited_at;
      }
      found.inviteCount = Math.max(found.inviteCount, row.invite_count);
      continue;
    }
    const profile = row.user_id ? names.get(row.user_id) : undefined;
    byKey.set(key, {
      userId: row.user_id,
      email: row.email,
      fullName: profile?.full_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      // Dalla riga, non dedotto da `user_id`: sono due sorgenti di verità che
      // oggi coincidono e domani no (una riga può essere collegata e in attesa).
      status: row.status === "active" ? "active" : "pending",
      rows: [row],
      venueIds: [row.venue_id],
      invitedAt: row.invited_at,
      inviteCount: row.invite_count,
    });
  }
  return [...byKey.values()];
}

/**
 * I **miei** accessi delegati. Vuoto per il titolare, che non ha righe qui.
 *
 * La RLS fa già il filtro (`user_id = auth.uid()`); il `.eq` esplicito c'è
 * perché una query senza `where` su una tabella che cresce con l'azienda è il
 * tipo di select che diventa un full scan quando le policy cambiano.
 */
export async function getMyVenueAccess(userId: string): Promise<VenueAccess[]> {
  const { data, error } = await supabase
    .from("venue_access")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** L'account di un indirizzo, se esiste e ha confermato l'email. */
export type TeamCandidate = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
};

/**
 * Chi c'è dietro un indirizzo. `null` se nessuno.
 *
 * Torna anche il **ruolo**, che è la differenza fra "mandiamogli un invito" e
 * "questo invito non servirà a niente": chi ha già un account da professionista
 * non può registrarsi di nuovo, e `link_venue_access_for_user` aggancia solo i
 * `manager`. Senza il ruolo la riga resterebbe `pending` per sempre e il
 * titolare non saprebbe perché.
 */
export async function findTeamCandidate(
  email: string
): Promise<TeamCandidate | null> {
  const { data, error } = await supabase.rpc("find_team_candidate", {
    p_email: email,
  });
  if (error) throw new Error(error.message);
  return (data?.[0] as TeamCandidate | undefined) ?? null;
}

export type AddTeamMemberInput = {
  ownerId: string;
  email: string;
  venueIds: string[];
  permissions: TeamPermissions;
};

export type AddTeamMemberResult =
  /** La persona aveva già un account: l'accesso è attivo da subito. */
  | { kind: "linked"; name: string | null }
  /** Nessun account: riga in attesa e invito spedito (o no, se l'SMTP ha detto no). */
  | { kind: "invited"; emailSent: boolean }
  /** Aveva già accesso a **tutte** le sedi scelte: niente da fare. */
  | { kind: "already" };

/**
 * Aggiunge un collaboratore.
 *
 * Un solo punto d'ingresso con dentro la decisione, invece di due modalità da
 * scegliere a mano: chi invita non sa — e non deve sapere — se la persona ha già
 * un account topWaitr. È la stessa forma di `addStaff()` per l'organico.
 *
 * Le sedi si trattano una per una perché i tre casi convivono nella stessa
 * chiamata: su una c'è già, su una c'era e gli è stato tolto, su una è nuovo.
 * ⚠️ Un solo `insert` di tutte le righe fallirebbe **per intero** alla prima
 * unique violata, e il titolare vedrebbe "ha già accesso" mentre le sedi nuove
 * non gliele ha date nessuno.
 */
export async function addTeamMember(
  input: AddTeamMemberInput
): Promise<AddTeamMemberResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await findTeamCandidate(email);

  // ⚠️ Un professionista non diventa collaboratore per email: non può
  // registrarsi di nuovo (l'account c'è) e `link_venue_access_for_user` aggancia
  // solo i `manager`. Senza questo controllo la riga resta `pending` per sempre.
  if (existing && existing.role !== "manager") {
    throw new UserFacingError(
      "Questo indirizzo ha già un account da professionista. Per farla entrare nella gestione serve un account da locale, con un'altra email."
    );
  }

  // Le righe che questo titolare ha già su quelle sedi. La revoca non cancella,
  // e le due unique non escludono le righe revocate: senza guardarle prima,
  // reinvitare chi era stato tolto darebbe 23505 e nessuna via d'uscita.
  const { data: onVenues, error: readError } = await supabase
    .from("venue_access")
    .select("id, venue_id, status, user_id, email")
    .eq("owner_id", input.ownerId)
    .in("venue_id", input.venueIds);
  if (readError) throw new Error(readError.message);

  const mine = (onVenues ?? []).filter(
    (r) =>
      (existing != null && r.user_id === existing.id) ||
      (r.email ?? "").trim().toLowerCase() === email
  );
  const revived = mine.filter((r) => r.status === "revoked");
  const taken = new Set(mine.map((r) => r.venue_id));
  const missing = input.venueIds.filter((id) => !taken.has(id));

  if (revived.length === 0 && missing.length === 0) return { kind: "already" };

  const state = {
    user_id: existing?.id ?? null,
    email,
    status: existing ? "active" : "pending",
    ...input.permissions,
  };

  const touched: string[] = [];

  if (revived.length > 0) {
    // `invite_count` e `invited_at` ripartono da zero: è un invito nuovo, non il
    // sesto tentativo di quello vecchio. Il tetto che conta resta quello del
    // titolare (20 email in 24 ore, in `claim_venue_access_send`), che questo
    // giro non azzera.
    const ids = revived.map((r) => r.id);
    const { error } = await supabase
      .from("venue_access")
      .update({ ...state, invite_count: 0, invited_at: null })
      .in("id", ids);
    if (error) throw teamError(error.message);
    touched.push(...ids);
  }

  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from("venue_access")
      .insert(
        missing.map((venueId) => ({
          venue_id: venueId,
          owner_id: input.ownerId,
          ...state,
        }))
      )
      // ⚠️ Gli id arrivano da qui e non da una select successiva per indirizzo:
      // lo stesso indirizzo può avere righe su più sedi, e la "prima per
      // `created_at`" era quella di un invito precedente — l'email nominava la
      // sede sbagliata e bruciava i rate limit su una riga che non c'entrava.
      .select("id");
    if (error) throw teamError(error.message);
    touched.push(...(created ?? []).map((r) => r.id));
  }

  if (existing) return { kind: "linked", name: existing.full_name };

  // L'invito si manda a una riga sola: l'email nomina una sede, e cinque email
  // per cinque sedi sono cinque email.
  const accessId = touched[0];
  if (!accessId) return { kind: "invited", emailSent: false };

  try {
    await sendTeamInvite(accessId);
    return { kind: "invited", emailSent: true };
  } catch {
    // L'accesso è stato creato: se l'email non parte, il titolare ha comunque
    // una riga in lista e un pulsante "Reinvia". Fallire tutto qui vorrebbe dire
    // buttare via un invito già valido perché l'SMTP era occupato.
    return { kind: "invited", emailSent: false };
  }
}

/**
 * I messaggi dei vincoli DB, tradotti.
 *
 * ⚠️ `UserFacingError` e non `Error`: `userErrorMessage()` generalizza qualunque
 * messaggio non marcato, e queste frasi sono scritte per essere lette così come
 * sono (vedi src/lib/errors.ts).
 */
function teamError(message: string): Error {
  if (message.includes("already_in_other_company")) {
    return new UserFacingError(
      "Questa persona collabora già con un altro locale su topWaitr."
    );
  }
  if (message.includes("already_owns_venues")) {
    return new UserFacingError("Questa persona ha già un locale suo su topWaitr.");
  }
  // I due controlli di `venue_access_user_matches_email`: l'app non dovrebbe mai
  // vederli — li produce chi scrive un `user_id` che non corrisponde all'email.
  if (message.includes("user_email_mismatch") || message.includes("not_a_manager")) {
    return new UserFacingError(
      "Questo indirizzo non corrisponde a un account da locale."
    );
  }
  return new Error(message);
}

/**
 * Cambia i permessi di una persona su una sede sola.
 *
 * Per sede e non per persona di proposito: chi gestisce due sedi può avere due
 * mestieri diversi, e un'unica scrittura "su tutte le sedi" cancellerebbe la
 * differenza senza dirlo.
 */
export async function updateTeamPermissions(
  accessId: string,
  permissions: Partial<TeamPermissions>
): Promise<void> {
  const { error } = await supabase
    .from("venue_access")
    .update(permissions)
    .eq("id", accessId);
  if (error) throw new Error(error.message);
}

/**
 * Aggiunge una sede a un collaboratore che già c'è.
 *
 * Come in `addTeamMember`, una riga revocata su quella sede si riapre invece di
 * essere reinserita: la unique `(venue_id, lower(email))` non esclude le
 * revocate, e un `insert` cieco darebbe 23505 a chi sta solo ridando una sede
 * che aveva tolto.
 */
export async function addTeamVenue(
  ownerId: string,
  member: TeamMember,
  venueId: string,
  permissions: TeamPermissions
): Promise<void> {
  const state = {
    user_id: member.userId,
    email: member.email,
    status: member.userId ? "active" : "pending",
    ...permissions,
  };

  // ⚠️ Il confronto si fa qui e non con un `.or()`: l'indirizzo finirebbe dentro
  // la sintassi dei filtri PostgREST, dove una virgola o una parentesi nel testo
  // cambia il significato della query. Le righe revocate di una sede sono poche.
  const email = (member.email ?? "").trim().toLowerCase();
  const { data: existing, error: readError } = await supabase
    .from("venue_access")
    .select("id, user_id, email")
    .eq("owner_id", ownerId)
    .eq("venue_id", venueId)
    .eq("status", "revoked");
  if (readError) throw new Error(readError.message);

  const revoked = (existing ?? []).find(
    (r) =>
      (member.userId != null && r.user_id === member.userId) ||
      (r.email ?? "").trim().toLowerCase() === email
  )?.id;
  const { error } = revoked
    ? await supabase
        .from("venue_access")
        .update({ ...state, invite_count: 0, invited_at: null })
        .eq("id", revoked)
    : await supabase
        .from("venue_access")
        .insert({ venue_id: venueId, owner_id: ownerId, ...state });
  if (error) throw teamError(error.message);
}

/**
 * Gli accessi che questo titolare ha dato a **questa persona**, sede per sede.
 *
 * Serve alla scheda di un membro dell'organico: la promozione si fa da lì, dove
 * il titolare sta già guardando chi è quella persona e in quali sedi lavora.
 * Torna anche le righe revocate: qui servono a dire «gliel'avevi tolta», che
 * nella lista dei collaboratori invece è rumore.
 */
export async function getPersonAccess(
  ownerId: string,
  userId: string
): Promise<VenueAccess[]> {
  const { data, error } = await supabase
    .from("venue_access")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Promuove un membro dell'organico a gestire una sede.
 *
 * Nessuna email e nessun invito: la persona è già nota, ha già un account, e il
 * legame che la autorizza è la sua appartenenza all'organico di **quella** sede
 * — che il trigger `venue_access_user_matches_email` va a verificare
 * (20260916140000). È la ragione per cui questo non passa da `addTeamMember`:
 * lì la chiave è l'indirizzo, qui è la persona.
 *
 * ⚠️ Il suo `profiles.role` resta `waiter`. In app cambia solo la vista, che
 * sceglie lui (`features/team/ViewMode.tsx`).
 */
export async function promoteStaffPerson(input: {
  ownerId: string;
  venueId: string;
  userId: string;
  permissions: TeamPermissions;
}): Promise<void> {
  const existing = await supabase
    .from("venue_access")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("venue_id", input.venueId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  // Una revoca non cancella la riga, e la unique `(venue_id, user_id)` non
  // esclude le revocate: ripromuovere è un update, non una insert.
  const { error } = existing.data
    ? await supabase
        .from("venue_access")
        .update({ status: "active", ...input.permissions })
        .eq("id", existing.data.id)
    : await supabase.from("venue_access").insert({
        venue_id: input.venueId,
        owner_id: input.ownerId,
        user_id: input.userId,
        status: "active",
        ...input.permissions,
      });
  if (error) throw teamError(error.message);
}

/**
 * Revoca l'accesso, su una sede o su tutte.
 *
 * `status = 'revoked'` e non una delete: è il passaggio che fa scattare la
 * notifica `team_removed`. Togliere l'accesso in silenzio a chi ieri organizzava
 * i turni non è una cosa che si fa senza dirlo.
 */
export async function revokeTeamAccess(accessIds: string[]): Promise<void> {
  if (accessIds.length === 0) return;
  const { error } = await supabase
    .from("venue_access")
    .update({ status: "revoked" })
    .in("id", accessIds);
  if (error) throw new Error(error.message);
}

/**
 * Rimanda l'email d'invito.
 *
 * Il body porta solo l'id della riga, mai un indirizzo: per spedire a qualcuno
 * bisogna prima averlo scritto su un proprio accesso, dove l'unique e
 * `invite_count` lo tengono sotto controllo. Stessa scelta di `sendStaffInvite`.
 */
export async function sendTeamInvite(accessId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ error?: string }>(
    "invite-staff",
    { body: { kind: "team", accessId } }
  );
  if (!error) return;

  // `functions.invoke` non mette il corpo della risposta dentro `error` sui
  // 4xx/5xx: il codice vero sta in `data`, ed è l'unico modo per distinguere
  // "riprova tra un po'" da "riprova adesso".
  const code = `${data?.error ?? ""} ${error.message ?? ""}`;

  if (code.includes("rate_limited")) {
    throw new UserFacingError(
      "Invito già mandato da poco. Potrai rimandarlo tra un quarto d'ora."
    );
  }
  if (code.includes("already_linked")) {
    throw new UserFacingError("Questa persona ha già un account collegato.");
  }
  if (code.includes("no_email")) {
    throw new UserFacingError("Questo accesso non ha un'email.");
  }
  if (code.includes("NOT_FOUND")) {
    // La Edge Function non è deployata: nessun workflow la pubblica, va fatto
    // a mano con `supabase functions deploy invite-staff`.
    throw new UserFacingError(
      "Gli inviti via email non sono ancora attivi su questo progetto."
    );
  }
  throw new UserFacingError(
    "Non siamo riusciti a mandare l'invito. Riprova tra qualche minuto."
  );
}
