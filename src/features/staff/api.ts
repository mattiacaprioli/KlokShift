import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { functionErrorCode } from "@/lib/functionError";
import type { Enums, Json } from "@/types/database";
import type { EmploymentType } from "@/features/workspace/types";
import { isContractPeriod } from "./contract";
import {
  linkStatusOf,
  type OwnerPerson,
  type PersonMembership,
  type ProfileBrief,
  type StaffMember,
  type StaffMemberWithWaiter,
  type StaffPerson,
  type StaffPersonDetail,
  type StaffRoleRef,
} from "./types";

/**
 * L'organico dell'azienda, dal DB nuovo ai tipi di sempre.
 *
 * Sotto ci sono `workspace_members` (la **persona**: anagrafica, account,
 * `member_hr` per note e contratto) e `venue_members` (la sua **riga di organico**
 * in una sede, con `venue_member_roles`). I tipi che le schermate usano sono in
 * `./types` e restano quelli storici: qui si **producono** da quelle tabelle.
 *
 * Due id da non confondere:
 *   - `StaffPerson.id` = `workspace_members.id` («member id»);
 *   - `StaffMember.id` = `venue_members.id` («venue member id»): è il bersaglio
 *     delle assegnazioni (`shift_assignments.venue_member_id`).
 *
 * Le scritture passano **solo** dalle RPC (`add_member`, `update_member`,
 * `set_member_venue`, `remove_member`, `leave`): atomiche, con errori
 * `raise exception '<codice>'` già tradotti da `userErrorMessage`.
 *
 * ⚠️ Questo file lo importa **anche la dashboard web**: niente Expo o React
 * Native qui dentro.
 */
export type {
  LinkStatus,
  OwnerPerson,
  PersonMembership,
  ProfileBrief,
  StaffMember,
  StaffMemberWithWaiter,
  StaffPerson,
  StaffPersonDetail,
  StaffRoleRef,
} from "./types";
export { linkStatusOf } from "./types";

// ---------------------------------------------------------------------------
// Forme grezze delle select (annotate `string`: gli embed annidati fanno
// esplodere l'inferenza dei tipi generati, e il cast qui sotto è l'unico punto).
// ---------------------------------------------------------------------------

const PERSON_COLUMNS =
  "id, workspace_id, user_id, display_name, phone, email, authority, status, link_conflict_at, created_at, " +
  "hr:member_hr(note, contract_hours, contract_period)";

const VENUE_EMBED =
  "venue:venues!venue_members_venue_id_workspace_id_fkey(id, name, city, closed_at, clock_method)";

const ROLES_EMBED =
  "roles:venue_member_roles(role:venue_roles(id, name, sort_order))";

const MEMBERSHIPS_EMBED =
  "memberships:venue_members(id, venue_id, employment_type, clock_method, left_at, created_at, " +
  VENUE_EMBED +
  ", " +
  ROLES_EMBED +
  ")";

const PEOPLE_SELECT: string =
  PERSON_COLUMNS +
  ", waiter:profiles!workspace_members_user_id_fkey(id, full_name, avatar_url), " +
  MEMBERSHIPS_EMBED;

// Le lingue arrivano da `waiter_profiles`, che è il profilo della **persona**:
// la RLS le concede a chi ce l'ha in azienda (`private.visible_profile_ids()`),
// e un embed che la RLS scarta torna `null`, non un errore. Sono l'unico campo
// del vecchio profilo-vetrina che serve a comporre una sala, e stanno qui
// perché è qui che il titolare guarda chi ha.
//
// `birth_day`/`birth_month` e non una data di nascita: l'anno non esiste proprio
// in `profiles`, quindi non c'è un'età da consegnare al titolare.
const PERSON_DETAIL_SELECT: string =
  PERSON_COLUMNS +
  ", waiter:profiles!workspace_members_user_id_fkey(id, full_name, avatar_url, birth_day, birth_month, " +
  "waiter_profile:waiter_profiles(languages)), " +
  MEMBERSHIPS_EMBED;

const VENUE_STAFF_SELECT: string =
  "id, venue_id, member_id, employment_type, left_at, created_at, " +
  "member:workspace_members!venue_members_member_id_workspace_id_fkey(" +
  "id, user_id, display_name, phone, status, hr:member_hr(note), " +
  "waiter:profiles!workspace_members_user_id_fkey(id, full_name, avatar_url)), " +
  ROLES_EMBED;

type RawHr = {
  note: string | null;
  contract_hours: number | null;
  contract_period: string | null;
};

type RawRoles = { role: StaffRoleRef | null }[];

type RawVenueBrief = {
  id: string;
  name: string;
  city: string | null;
  closed_at: string | null;
  clock_method: Enums<"clock_method">;
} | null;

type RawVenueMember = {
  id: string;
  venue_id: string;
  employment_type: EmploymentType;
  clock_method: PersonMembership["clock_method"];
  left_at: string | null;
  created_at: string;
  venue: RawVenueBrief;
  roles: RawRoles;
};

type RawMember = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  display_name: string;
  phone: string | null;
  email: string | null;
  authority: StaffPerson["authority"];
  status: StaffPerson["status"];
  link_conflict_at: string | null;
  created_at: string;
  /** Uno-a-uno: PostgREST lo dà come oggetto, ma un array non deve rompere. */
  hr: RawHr | RawHr[] | null;
  waiter:
    | (ProfileBrief & {
        birth_day?: number | null;
        birth_month?: number | null;
        /** Uno-a-uno su `profiles.id`: oggetto, oppure `null` se la RLS lo scarta. */
        waiter_profile?: { languages: string[] | null } | null;
      })
    | null;
  memberships: RawVenueMember[];
};

type RawRosterRow = {
  id: string;
  venue_id: string;
  member_id: string;
  employment_type: EmploymentType;
  left_at: string | null;
  created_at: string;
  member: {
    id: string;
    user_id: string | null;
    display_name: string;
    phone: string | null;
    status: StaffPerson["status"];
    hr: { note: string | null } | { note: string | null }[] | null;
    waiter: ProfileBrief | null;
  } | null;
  roles: RawRoles;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toPerson(row: RawMember): StaffPerson {
  const hr = one(row.hr);
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    full_name: row.display_name,
    phone: row.phone,
    note: hr?.note ?? null,
    email: row.email,
    waiter_id: row.user_id,
    authority: row.authority,
    status: row.status,
    contract_hours: hr?.contract_hours ?? null,
    contract_period:
      hr?.contract_period && isContractPeriod(hr.contract_period)
        ? hr.contract_period
        : null,
    // ⚠️ `member_invites` non ha nessun accesso da REST (contiene l'hash del
    // token): l'ultimo invio non è leggibile dal client. Restano i campi, vuoti.
    invited_at: null,
    invite_count: 0,
    invite_conflict_at: row.link_conflict_at,
    created_at: row.created_at,
  };
}

function toMembership(row: RawMember, vm: RawVenueMember): PersonMembership {
  return {
    id: vm.id,
    venue_id: vm.venue_id,
    link_status: linkStatusOf(row.status, vm.left_at),
    employment_type: vm.employment_type,
    clock_method: vm.clock_method,
    created_at: vm.created_at,
    left_at: vm.left_at,
    venue: vm.venue,
    staff_member_roles: vm.roles ?? [],
  };
}

// ---------------------------------------------------------------------------
// Ruoli e sintesi di riga
// ---------------------------------------------------------------------------

/**
 * I nomi dei ruoli di una persona, in un'unica riga ("Cameriere, Barman").
 * Punto solo: la stessa stringa la mostrano organico, planning e scheda, e
 * ricomporla a mano ogni volta è il modo in cui due schermate iniziano a
 * ordinarla diversamente.
 */
export function staffRoleNames(member: {
  staff_member_roles: { role: StaffRoleRef | null }[];
}): string | null {
  const names = member.staff_member_roles
    .map((r) => r.role)
    .filter((r): r is StaffRoleRef => !!r)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => r.name);
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * Le sedi (aperte) in cui la persona lavora: i chip della riga dell'organico.
 *
 * Le sedi chiuse restano fuori — un chip "Osteria Como" per una sede chiusa sei
 * mesi fa manda solo a cercare un turno che non si può fare.
 */
export function personVenueNames(person: OwnerPerson): string[] {
  return person.memberships
    .filter((m) => !m.venue?.closed_at)
    .map((m) => m.venue?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "it"));
}

/**
 * Le mansioni della persona, **unite fra le sue sedi** ("Cameriere, Barman").
 *
 * L'unione e non un elenco per sede: `venue_roles` è per sede, quindi Marco
 * può essere "Cameriere" a Roma e "Barman" a Milano, e in una riga d'elenco
 * quello che si vuole sapere è cosa sa fare — non dove. Il dettaglio per sede
 * sta nella sua scheda, dove `WorkplaceCard` lo mostra già.
 */
export function personRoleNames(person: OwnerPerson): string | null {
  const byId = new Map<string, StaffRoleRef>();
  for (const m of person.memberships) {
    for (const { role } of m.staff_member_roles) {
      // Chiave sul **nome**: due sedi che hanno entrambe "Cameriere" sono due
      // righe `venue_roles` diverse, e l'id le farebbe comparire due volte.
      if (role) byId.set(role.name.toLowerCase(), role);
    }
  }
  const names = [...byId.values()]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "it"))
    .map((r) => r.name);
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * Il tipo di impiego, se è lo stesso **in tutte** le sedi della persona.
 *
 * `null` quando divergono: si può essere fissi a Roma e a chiamata a Milano, e
 * mostrarne uno solo sarebbe una bugia detta con sicurezza.
 */
export function personEmploymentType(
  person: OwnerPerson
): StaffMember["employment_type"] | null {
  const open = person.memberships.filter((m) => !m.venue?.closed_at);
  if (open.length === 0) return null;
  const first = open[0].employment_type;
  return open.every((m) => m.employment_type === first) ? first : null;
}

// ---------------------------------------------------------------------------
// Letture
// ---------------------------------------------------------------------------

/** L'organico di una sede: le righe di `venue_members` con la persona e i ruoli. */
export async function getVenueStaff(
  venueId: string
): Promise<StaffMemberWithWaiter[]> {
  const { data, error } = await supabase
    .from("venue_members")
    .select(VENUE_STAFF_SELECT)
    .eq("venue_id", venueId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as RawRosterRow[] | null) ?? [];
  return rows.flatMap((row): StaffMemberWithWaiter[] => {
    const m = row.member;
    // Una riga di organico senza la persona non è leggibile (RLS): si salta.
    if (!m) return [];
    return [
      {
        id: row.id,
        venue_id: row.venue_id,
        person_id: row.member_id,
        display_name: m.display_name,
        waiter_id: m.user_id,
        phone: m.phone,
        note: one(m.hr)?.note ?? null,
        employment_type: row.employment_type,
        link_status: linkStatusOf(m.status, row.left_at),
        left_at: row.left_at,
        created_at: row.created_at,
        waiter: m.waiter,
        staff_member_roles: row.roles ?? [],
      },
    ];
  });
}

/**
 * La persona con **tutte** le sue appartenenze: è la scheda del dipendente.
 *
 * Una scheda per persona, non una per sede. Ore, presenze e affidabilità sono
 * dell'azienda; ruoli e tipo di impiego restano della sede, e stanno nelle
 * `memberships` — comprese quelle finite, che sono lo storico delle ore.
 */
export async function getStaffPerson(
  personId: string
): Promise<StaffPersonDetail | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(PERSON_DETAIL_SELECT)
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as RawMember | null;
  if (!row) return null;
  const waiter = row.waiter
    ? {
        id: row.waiter.id,
        full_name: row.waiter.full_name,
        avatar_url: row.waiter.avatar_url,
        birth_day: row.waiter.birth_day ?? null,
        birth_month: row.waiter.birth_month ?? null,
        // Appiattito qui: che le lingue stiano in un'altra tabella è un fatto
        // di PostgREST, non qualcosa che le due schede devono sapere.
        languages: row.waiter.waiter_profile?.languages ?? [],
      }
    : null;
  return {
    ...toPerson(row),
    waiter,
    memberships: row.memberships
      .map((vm) => toMembership(row, vm))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

/**
 * Tutte le persone dell'organico dell'azienda, **attraverso le sedi**.
 *
 * È **l'elenco dell'organico**: la tab Staff mostra questo, e serve anche alla
 * chat, dove il thread è per persona. Una persona compare se lavora **adesso** in
 * almeno una sede: chi è solo collaboratore (nessuna riga di organico) sta nella
 * pagina Collaboratori, chi se n'è andato resta raggiungibile da Ore e dallo
 * storico, dove `getStaffPerson` le appartenenze finite le mostra apposta.
 */
export async function getOwnerPeople(
  workspaceId: string
): Promise<OwnerPerson[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(PEOPLE_SELECT)
    .eq("workspace_id", workspaceId)
    .neq("status", "left")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as RawMember[] | null) ?? [];

  return rows
    .map((row): OwnerPerson => {
      const memberships = row.memberships
        .map((vm) => toMembership(row, vm))
        .filter((m) => m.link_status !== "left");
      return {
        ...toPerson(row),
        waiter: row.waiter
          ? {
              id: row.waiter.id,
              full_name: row.waiter.full_name,
              avatar_url: row.waiter.avatar_url,
            }
          : null,
        memberships: memberships.map((m) => ({
          id: m.id,
          venue_id: m.venue_id,
          link_status: m.link_status,
          employment_type: m.employment_type,
          clock_method: m.clock_method,
          venue: m.venue,
          staff_member_roles: m.staff_member_roles,
        })),
      };
    })
    .filter((p) => p.memberships.length > 0);
}

// ---------------------------------------------------------------------------
// Scritture: solo RPC
// ---------------------------------------------------------------------------

/** La risposta di `add_member`. */
type AddMemberOutcome =
  | "created_manual"
  | "invited_in_app"
  | "invite_email"
  | "already_member"
  | "self";

type AddMemberResponse = {
  member_id: string;
  outcome: AddMemberOutcome;
  venue_member_ids: string[];
};

type VenuePlacement = {
  venueIds: string[];
  employmentType: EmploymentType;
  /** Le mansioni, solo se si aggiunge in **una** sede (sono per sede). */
  roleIds?: string[];
};

function venuesPayload(p: VenuePlacement): Json {
  return p.venueIds.map((venue_id) => ({
    venue_id,
    employment_type: p.employmentType,
    ...(p.roleIds && p.venueIds.length === 1 ? { role_ids: p.roleIds } : {}),
  }));
}

async function callAddMember(args: {
  workspaceId: string;
  person?: Json;
  placement: VenuePlacement;
  self?: boolean;
}): Promise<AddMemberResponse> {
  const { data, error } = await supabase.rpc("add_member", {
    p_workspace: args.workspaceId,
    p_person: args.person ?? {},
    p_authority: "none",
    p_venues: venuesPayload(args.placement),
    p_self: args.self ?? false,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AddMemberResponse;
}

/**
 * Manda l'email d'invito a una persona in organico (o a un collaboratore) che
 * non ha ancora un account. Il server prende l'indirizzo dalla scheda: qui si
 * passa solo il membro, così nessuna chiamata può spedire a un indirizzo
 * arbitrario. Il canale (link alla vetrina / token per la dashboard) lo decide
 * il DB in base all'`authority`.
 */
export async function sendStaffInvite(memberId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("invite-staff", {
    body: { memberId },
  });
  if (!error) return;

  // Il codice vero sta nel corpo della risposta, dentro `error.context`: è
  // l'unico modo per distinguere "riprova tra un po'" da "riprova adesso"
  // (vedi `functionErrorCode`).
  const code = `${await functionErrorCode(error)} ${error.message ?? ""}`;

  // ⚠️ `UserFacingError` e non `Error`: `userErrorMessage()` generalizza
  // qualunque messaggio non marcato, e queste frasi sono scritte per essere
  // lette così come sono (vedi src/lib/errors.ts).
  if (code.includes("rate_limited")) {
    throw new UserFacingError(
      "Invito già mandato da poco. Potrai rimandarlo tra un quarto d'ora."
    );
  }
  if (code.includes("already_linked")) {
    throw new UserFacingError("Questa persona ha già un account collegato.");
  }
  if (code.includes("no_email")) {
    throw new UserFacingError("Questa scheda non ha un'email.");
  }
  // La function verifica chi chiama con `auth.getUser()`: se la sessione non
  // esiste più (revocata altrove) il token continua a valere per PostgREST ma
  // non per GoTrue, quindi le altre schermate funzionano e solo l'invito no.
  // Dire «riprova tra qualche minuto» manderebbe a sbattere all'infinito.
  if (code.includes("invalid token") || code.includes("missing authorization")) {
    throw new UserFacingError(
      "La tua sessione non è più valida. Esci, rientra e riprova."
    );
  }
  if (code.includes("NOT_FOUND")) {
    // La Edge Function non è deployata: nessun workflow la pubblica, va fatto
    // a mano con `supabase functions deploy invite-staff`. Dirlo, invece di
    // suggerire un "riprova" che non cambierebbe niente.
    throw new UserFacingError(
      "Gli inviti via email non sono ancora attivi su questo progetto."
    );
  }
  throw new UserFacingError(
    "Non siamo riusciti a mandare l'invito. Riprova tra qualche minuto."
  );
}

/**
 * Come è finita l'aggiunta di una persona. Serve alla UI per dire la cosa
 * giusta: "Aggiunto allo staff" e "Invito spedito" non sono la stessa frase, e
 * `already` non è nemmeno un successo.
 */
export type AddStaffResult =
  | { kind: "manual"; personId: string; venueMemberIds: string[] }
  | { kind: "app_invite"; personId: string; venueMemberIds: string[] }
  | {
      kind: "email_invite";
      personId: string;
      venueMemberIds: string[];
      emailSent: boolean;
      /** Perché l'email non è partita, già in italiano. Assente se è partita. */
      emailError?: string;
    }
  | { kind: "already"; personId: string };

/**
 * Aggiunge una persona all'organico, email o no: una sola RPC (`add_member`).
 *
 * ⚠️ La domanda «questa persona ha già KlokShift?» **non è del titolare** e non
 * è nemmeno del client: `add_member` guarda l'email e risponde con l'esito.
 *
 * - niente email  → scheda e basta (si potrà invitare dopo, dalla sua scheda);
 * - account trovato → invito in-app da accettare (`invited_in_app`);
 * - nessun account → scheda con l'email + email d'invito (`invite_email`):
 *   quando quella persona si registrerà con quell'indirizzo, verrà agganciata;
 * - già in azienda → `already_member`.
 *
 * Le mansioni (`roleIds`) si passano solo con **una** sede: sono per sede, e la
 * stessa lista non varrebbe per due.
 */
export async function addStaff(args: {
  workspaceId: string;
  venueIds: string[];
  fullName: string;
  employmentType: EmploymentType;
  phone?: string | null;
  email?: string | null;
  roleIds?: string[];
}): Promise<AddStaffResult> {
  const email = args.email?.trim() || null;
  const phone = args.phone?.trim() || null;
  const res = await callAddMember({
    workspaceId: args.workspaceId,
    person: {
      full_name: args.fullName.trim(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    },
    placement: {
      venueIds: args.venueIds,
      employmentType: args.employmentType,
      roleIds: args.roleIds,
    },
  });

  const base = { personId: res.member_id, venueMemberIds: res.venue_member_ids };

  switch (res.outcome) {
    case "already_member":
      return { kind: "already", personId: res.member_id };
    case "invited_in_app":
      return { kind: "app_invite", ...base };
    case "invite_email":
      // La scheda è valida anche senza l'email spedita: l'SMTP che rifiuta non è
      // un buon motivo per buttare via il lavoro appena fatto dal titolare. Si
      // dice che l'invito non è partito e si lascia il bottone «Reinvia».
      try {
        await sendStaffInvite(res.member_id);
        return { kind: "email_invite", ...base, emailSent: true };
      } catch (e) {
        return {
          kind: "email_invite",
          ...base,
          emailSent: false,
          emailError: e instanceof UserFacingError ? e.message : undefined,
        };
      }
    default:
      return { kind: "manual", ...base };
  }
}

/**
 * Chi gestisce l'azienda si mette **da sé** nel proprio organico
 * (`add_member` con `p_self: true`).
 *
 * Il caso vero è il titolare che lavora — fa il servizio, copre un buco, sta al
 * bar — e le cui ore prima non esistevano da nessuna parte. Vale anche per un
 * collaboratore con il permesso Staff. Nessuna email e nessun invito: **il
 * consenso è il gesto stesso**, e il nome è quello che ha già nell'azienda.
 * `phone`, se c'è, si scrive sulla sua scheda con `update_member`.
 */
export async function addSelfToStaff(args: {
  workspaceId: string;
  venueIds: string[];
  employmentType: EmploymentType;
  roleIds?: string[];
  phone?: string | null;
}): Promise<{ personId: string; venueMemberIds: string[] }> {
  const res = await callAddMember({
    workspaceId: args.workspaceId,
    placement: {
      venueIds: args.venueIds,
      employmentType: args.employmentType,
      roleIds: args.roleIds,
    },
    self: true,
  });
  const phone = args.phone?.trim();
  if (phone) await updateStaffPerson(res.member_id, { phone });
  return { personId: res.member_id, venueMemberIds: res.venue_member_ids };
}

/**
 * Aggiunge (o rimette) una persona in organico in una sede. Nessun invito:
 * l'accordo con l'azienda c'è già. Se in quella sede c'era stata e se n'era
 * andata, la RPC rianima la riga di prima, con le mansioni che aveva — l'unique
 * `(member, venue)` non ne ammette una seconda. Ritorna l'id della riga di
 * organico (`venue_members.id`).
 */
export async function addPersonToVenue(args: {
  memberId: string;
  venueId: string;
  employmentType: EmploymentType;
  roleIds?: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("set_member_venue", {
    p_member: args.memberId,
    p_venue: args.venueId,
    p_employment_type: args.employmentType,
    ...(args.roleIds ? { p_role_ids: args.roleIds } : {}),
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Cosa si può cambiare dell'anagrafica e del contratto (`update_member`). */
export type StaffPersonPatch = {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  contract_hours?: number | null;
  contract_period?: "day" | "week" | "month" | null;
};

/**
 * L'anagrafica della persona: vale in **tutte** le sedi dell'azienda. Rinominare
 * Marco dalla scheda di Milano lo rinomina anche a Roma, ed è il punto del
 * modello — è la stessa persona. Le chiavi assenti non si toccano.
 */
export async function updateStaffPerson(
  id: string,
  fields: StaffPersonPatch
): Promise<void> {
  const { full_name, ...rest } = fields;
  const patch: { [key: string]: Json | undefined } = { ...rest };
  if (full_name !== undefined) patch.display_name = full_name;
  const { error } = await supabase.rpc("update_member", {
    p_member: id,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
}

/**
 * Quel che è davvero della singola sede: tipo di impiego e mansioni, in **una**
 * scrittura (`set_member_venue`). Si può essere fissi a Roma e a chiamata a
 * Milano. `roleIds` assente = le mansioni non si toccano.
 */
export async function updateStaffMember(args: {
  memberId: string;
  venueId: string;
  employmentType: EmploymentType;
  roleIds?: string[];
}): Promise<void> {
  await addPersonToVenue(args);
}

/**
 * Toglie una persona dall'organico: da una sede (`venueId`) o da tutta l'azienda.
 *
 * ⚠️ **Non è un delete.** Le assegnazioni passate restano (sono le ore che
 * vanno al commercialista): la RPC segna l'uscita, libera i turni futuri e avvisa
 * il professionista. Il titolare non esce dall'azienda (si passa la titolarità):
 * per lui si può solo togliere una sede alla volta.
 */
export async function removeStaffMember(args: {
  memberId: string;
  venueId?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("remove_member", {
    p_member: args.memberId,
    ...(args.venueId ? { p_venue: args.venueId } : {}),
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Lato professionista
// ---------------------------------------------------------------------------

/** Una sede in cui lavoro, con la riga di organico (`venue_members.id`). */
export type MyEmployer = Pick<
  StaffMember,
  "id" | "venue_id" | "person_id" | "employment_type" | "link_status" | "created_at"
> & {
  workspace_id: string;
  venue: {
    id: string;
    name: string;
    city: string | null;
    logo_url: string | null;
    workspace_id: string;
  } | null;
};

type RawEmployer = {
  id: string;
  venue_id: string;
  member_id: string;
  workspace_id: string;
  employment_type: EmploymentType;
  left_at: string | null;
  created_at: string;
  workspace_members: { status: StaffPerson["status"] } | null;
  venue: MyEmployer["venue"];
};

/** Le sedi in cui sono in organico **adesso** (appartenenza attiva). */
export async function getMyEmployers(userId: string): Promise<MyEmployer[]> {
  const select: string =
    "id, venue_id, member_id, workspace_id, employment_type, left_at, created_at, " +
    "workspace_members!venue_members_member_id_workspace_id_fkey!inner(status, user_id), " +
    "venue:venues!venue_members_venue_id_workspace_id_fkey(id, name, city, logo_url, workspace_id)";
  const { data, error } = await supabase
    .from("venue_members")
    .select(select)
    .eq("workspace_members.user_id", userId)
    .is("left_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as RawEmployer[] | null) ?? [];
  return rows
    .filter((r) => r.workspace_members?.status === "active")
    .map((r) => ({
      id: r.id,
      venue_id: r.venue_id,
      person_id: r.member_id,
      workspace_id: r.workspace_id,
      employment_type: r.employment_type,
      link_status: "active" as const,
      created_at: r.created_at,
      venue: r.venue,
    }));
}

/**
 * Lascio una sede (`leave`). Prende l'id della **riga di organico**, come il
 * resto dell'app lato professionista, e da lì ricava persona e sede.
 */
export async function leaveVenue(venueMemberId: string): Promise<void> {
  const { data, error } = await supabase
    .from("venue_members")
    .select("member_id, venue_id")
    .eq("id", venueMemberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("not_allowed");

  const { error: leaveError } = await supabase.rpc("leave", {
    p_member: data.member_id,
    p_venue: data.venue_id,
  });
  if (leaveError) throw new Error(leaveError.message);
}
