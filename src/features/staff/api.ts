import { supabase } from "@/lib/supabase";
import type { Enums, Tables, TablesInsert, TablesUpdate } from "@/types/database";

export type StaffMember = Tables<"staff_members">;

/**
 * La persona, un livello sopra la scheda.
 *
 * Un titolare con più sedi ha **una** anagrafica per dipendente e tante
 * appartenenze (`staff_members`) quante sono le sedi in cui lavora: Marco a Roma
 * e a Milano è una persona con due schede, non due Marco. Sulla persona vivono
 * nome, telefono, note, l'account collegato e i documenti; sulla scheda il tipo
 * di impiego, lo stato dell'invito, i ruoli, i turni e le ore.
 *
 * Da 20260913110100 anche le **ore** sono di questo livello: `staff_members` resta
 * l'unità di *assegnazione* (il turno si fa in un locale, coi ruoli di quel
 * locale), `staff_people` è l'unità di *rendiconto* — 20 ore a Roma e 20 a Milano
 * sono 40 ore e una busta paga.
 *
 * ⚠️ `staff_members.display_name`, `.waiter_id`, `.phone` e `.note` sono un
 * **mirror** di sola lettura, riscritto da un trigger (20260913100000): scriverci
 * non dà errore e non salva niente. L'anagrafica si modifica da qui.
 */
export type StaffPerson = Tables<"staff_people">;

/** Una mansione della persona, come la carica l'embed dell'organico. */
export type StaffRoleRef = { id: string; name: string; sort_order: number };

/** Roster row + the linked waiter's avatar/name (when waiter_id is set). */
export type StaffMemberWithWaiter = StaffMember & {
  waiter: Pick<Tables<"profiles">, "id" | "full_name" | "avatar_url"> | null;
  staff_member_roles: { role: StaffRoleRef | null }[];
};

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

export async function getVenueStaff(
  venueId: string
): Promise<StaffMemberWithWaiter[]> {
  const { data, error } = await supabase
    .from("staff_members")
    .select(
      "*, waiter:profiles!staff_members_waiter_id_fkey(id, full_name, avatar_url), staff_member_roles(role:venue_roles(id, name, sort_order))"
    )
    .eq("venue_id", venueId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as StaffMemberWithWaiter[] | null) ?? [];
}

/** Una sede in cui la persona lavora, con quel che è **della sede**. */
export type PersonMembership = Pick<
  StaffMember,
  "id" | "venue_id" | "link_status" | "employment_type" | "created_at"
> & {
  venue: Pick<Tables<"venues">, "id" | "name" | "city" | "closed_at"> | null;
  staff_member_roles: { role: StaffRoleRef | null }[];
};

/**
 * La persona con **tutte** le sue appartenenze: è la scheda del dipendente.
 *
 * Una scheda per persona, non una per sede. Prima Marco ne aveva due (una per
 * locale) e ognuna mostrava le ore di quella sola sede — un'assenza a Milano non
 * scalfiva il 100% di affidabilità di Roma. Ore, presenze e affidabilità sono
 * dell'azienda; ruoli e tipo di impiego restano della sede, e stanno nelle
 * `memberships`.
 */
export type StaffPersonDetail = StaffPerson & {
  waiter: Pick<Tables<"profiles">, "id" | "full_name" | "avatar_url"> | null;
  memberships: PersonMembership[];
};

/**
 * Embed a tre livelli (`staff_people → staff_members → staff_member_roles →
 * venue_roles`), che compone due pezzi già in produzione: `memberships:` viene da
 * `getOwnerPeople`, i ruoli annidati da `getVenueStaff`. Entrambi non ambigui —
 * `staff_members` ha una sola FK verso `staff_people`.
 */
export async function getStaffPerson(
  personId: string
): Promise<StaffPersonDetail | null> {
  const { data, error } = await supabase
    .from("staff_people")
    .select(
      "*, waiter:profiles!staff_people_waiter_id_fkey(id, full_name, avatar_url), " +
        "memberships:staff_members(id, venue_id, link_status, employment_type, created_at, " +
        "venue:venues(id, name, city, closed_at), " +
        "staff_member_roles(role:venue_roles(id, name, sort_order)))"
    )
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StaffPersonDetail | null) ?? null;
}

/** Una persona del titolare, con le sedi in cui lavora e la sua foto. */
export type OwnerPerson = StaffPerson & {
  waiter: Pick<Tables<"profiles">, "id" | "full_name" | "avatar_url"> | null;
  memberships: (Pick<
    StaffMember,
    "id" | "venue_id" | "link_status" | "employment_type"
  > & {
    venue: Pick<
      Tables<"venues">,
      "id" | "name" | "city" | "closed_at"
    > | null;
  })[];
};

/**
 * Le **altre** sedi (aperte) in cui la persona lavora, per il badge dell'organico.
 *
 * Una funzione sola: la stessa frase la mostrano l'app e la dashboard, e
 * ricomporla a mano è il modo in cui due schermate iniziano a ordinarla
 * diversamente. Le sedi chiuse restano fuori — un badge "anche a Osteria Como" per
 * un locale chiuso sei mesi fa manda solo a cercare un turno che non si può fare.
 */
export function otherVenueNames(
  person: OwnerPerson | undefined,
  currentVenueId: string
): string[] {
  return (person?.memberships ?? [])
    .filter((m) => m.venue_id !== currentVenueId && !m.venue?.closed_at)
    .map((m) => m.venue?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "it"));
}

/**
 * Tutte le persone dell'organico del titolare, **attraverso le sedi**.
 *
 * È ciò che rende possibile "Marco lavora già a Roma, aggiungilo anche a Milano"
 * senza creargli una seconda anagrafica. Serve anche alla chat: il thread è per
 * persona, quindi il selettore dei destinatari non può fermarsi all'organico della
 * sede attiva — altrimenti dalla sede Roma non si potrebbe scrivere a chi si ha
 * solo a Milano.
 */
export async function getOwnerPeople(ownerId: string): Promise<OwnerPerson[]> {
  const { data, error } = await supabase
    .from("staff_people")
    .select(
      "*, waiter:profiles!staff_people_waiter_id_fkey(id, full_name, avatar_url), memberships:staff_members(id, venue_id, link_status, employment_type, venue:venues(id, name, city, closed_at))"
    )
    .eq("owner_id", ownerId)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as OwnerPerson[] | null) ?? [];
}

/**
 * Aggiunge a una sede una persona che il titolare **ha già** (perché lavora in
 * un'altra delle sue sedi). Nessun invito: l'account, se c'è, è già collegato
 * alla persona e il trigger lo copia sulla scheda nuova.
 */
export async function addPersonToVenue(
  input: TablesInsert<"staff_members">
): Promise<StaffMember> {
  const { data, error } = await supabase
    .from("staff_members")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Persona nuova + prima appartenenza, in due scritture.
 *
 * Se l'account è **già** una persona di questo titolare (lavora in un'altra sede)
 * si riusa quella: l'unique `staff_people (owner_id, waiter_id)` rifiuterebbe una
 * seconda anagrafica, e sarebbe comunque sbagliato crearla — è lo stesso Marco.
 *
 * Se la seconda scrittura fallisce si cancella la persona appena creata. Senza la
 * compensazione resterebbe una persona senza sedi, che nessuna schermata elenca e
 * che occuperebbe il posto nell'unique: il prossimo tentativo di invitare la
 * stessa email fallirebbe senza una ragione visibile. Stessa regola di
 * `createStaffDocument`.
 */
export async function addStaffToVenue(args: {
  ownerId: string;
  venueId: string;
  fullName: string;
  employmentType: Enums<"employment_type">;
  phone?: string | null;
  waiterId?: string | null;
  linkStatus?: Enums<"staff_link_status">;
}): Promise<StaffMember> {
  let personId: string | null = null;
  let created = false;

  if (args.waiterId) {
    const { data, error } = await supabase
      .from("staff_people")
      .select("id")
      .eq("owner_id", args.ownerId)
      .eq("waiter_id", args.waiterId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    personId = data?.id ?? null;
  }

  if (!personId) {
    const { data, error } = await supabase
      .from("staff_people")
      .insert({
        owner_id: args.ownerId,
        full_name: args.fullName,
        phone: args.phone ?? null,
        waiter_id: args.waiterId ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    personId = data.id;
    created = true;
  }

  try {
    return await addPersonToVenue({
      venue_id: args.venueId,
      person_id: personId,
      employment_type: args.employmentType,
      ...(args.linkStatus ? { link_status: args.linkStatus } : {}),
    });
  } catch (e) {
    if (created) {
      await supabase.from("staff_people").delete().eq("id", personId);
    }
    throw e;
  }
}

/**
 * L'anagrafica della persona: vale in **tutte** le sedi del titolare. Rinominare
 * Marco dalla scheda di Milano lo rinomina anche a Roma, ed è il punto del
 * modello — è la stessa persona.
 */
export async function updateStaffPerson(
  id: string,
  fields: TablesUpdate<"staff_people">
): Promise<void> {
  const { error } = await supabase
    .from("staff_people")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Quel che è davvero della singola sede: `employment_type` e `link_status`. Si
 * può essere fissi a Roma e a chiamata a Milano.
 */
export async function updateStaffMember(
  id: string,
  fields: TablesUpdate<"staff_members">
): Promise<void> {
  const { error } = await supabase
    .from("staff_members")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeStaffMember(id: string): Promise<void> {
  const { error } = await supabase.from("staff_members").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** A waiter found by exact email (via the DEFINER RPC). Only public fields. */
export type WaiterLookup = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
};

/** Manager: look up a waiter by exact email to invite them. */
export async function findWaiterByEmail(
  email: string
): Promise<WaiterLookup | null> {
  const { data, error } = await supabase.rpc("find_waiter_by_email", {
    p_email: email,
  });
  if (error) throw new Error(error.message);
  const row = (data as WaiterLookup[] | null)?.[0];
  return row ?? null;
}

/** Waiter: a pending staff invite joined with the venue. */
export type PendingInvite = StaffMember & {
  venue: Pick<Tables<"venues">, "id" | "name" | "city" | "logo_url"> | null;
};

/** Waiter: their pending staff invites ("Richieste di collaborazione"). */
export async function getMyPendingInvites(
  waiterId: string
): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("*, venue:venues(id, name, city, logo_url)")
    .eq("waiter_id", waiterId)
    .eq("link_status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PendingInvite[] | null) ?? [];
}

/** Waiter: a venue they're active staff for (their "I tuoi locali"). */
export type MyEmployer = StaffMember & {
  venue: Pick<
    Tables<"venues">,
    "id" | "name" | "city" | "logo_url" | "owner_id"
  > | null;
};

/** Waiter: the venues where they are confirmed (active) staff. */
export async function getMyEmployers(waiterId: string): Promise<MyEmployer[]> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("*, venue:venues(id, name, city, logo_url, owner_id)")
    .eq("waiter_id", waiterId)
    .eq("link_status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as MyEmployer[] | null) ?? [];
}

/**
 * Una "cartella" di documenti del professionista: **una per datore di lavoro**,
 * non una per locale.
 *
 * Se Giuseppe ha tre sedi e tu lavori in due, la cartella è una sola e i
 * documenti valgono per entrambe. Le sedi servono solo a dare un nome alla
 * cartella ("Da Buffa · Osteria Milano"), perché il nome del titolare non è quello
 * con cui uno riconosce il posto in cui lavora.
 */
export type DocumentScope = StaffPerson & {
  memberships: {
    venue: Pick<Tables<"venues">, "id" | "name" | "city"> | null;
  }[];
};

/**
 * Come si chiama una cartella: i nomi delle sedi, non quello del titolare — è
 * così che uno riconosce il posto in cui lavora. Un'unica funzione perché la
 * stessa etichetta la mostrano l'app e (in futuro) la dashboard, e ricomporla a
 * mano è il modo in cui due schermate iniziano a ordinarla diversamente.
 */
export function documentScopeLabel(scope: DocumentScope): string {
  const names = scope.memberships
    .map((m) => m.venue?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "it"));
  return names.length > 0 ? names.join(" · ") : "Locale";
}

/** Waiter: le sue cartelle documenti, una per titolare che lo ha in organico. */
export async function getMyDocumentScopes(
  waiterId: string
): Promise<DocumentScope[]> {
  const { data, error } = await supabase
    .from("staff_people")
    .select("*, memberships:staff_members(venue:venues(id, name, city))")
    .eq("waiter_id", waiterId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as DocumentScope[] | null) ?? [];
}

/** Waiter: accept (true) or decline (false) a staff invite (via DEFINER RPC). */
export async function respondToInvite(
  staffId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_staff_invite", {
    p_staff_id: staffId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
}

/** Waiter: resign from a venue's staff (via DEFINER RPC; notifies the owner). */
export async function leaveVenue(staffId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_venue", { p_staff_id: staffId });
  if (error) throw new Error(error.message);
}
