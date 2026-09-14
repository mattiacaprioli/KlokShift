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
  "id" | "venue_id" | "link_status" | "employment_type" | "created_at" | "left_at"
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
        "memberships:staff_members(id, venue_id, link_status, employment_type, created_at, left_at, " +
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
    staff_member_roles: { role: StaffRoleRef | null }[];
  })[];
};

/**
 * Le sedi (aperte) in cui la persona lavora: i chip della riga dell'organico.
 *
 * Le sedi chiuse restano fuori — un chip "Osteria Como" per un locale chiuso sei
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
 * L'unione e non un elenco per sede: `venue_roles` è per locale, quindi Marco
 * può essere "Cameriere" a Roma e "Barman" a Milano, e in una riga d'elenco
 * quello che si vuole sapere è cosa sa fare — non dove. Il dettaglio per sede
 * sta nella sua scheda, dove `WorkplaceCard` lo mostra già.
 *
 * Stesso criterio di `mergeRoles` in `assignments/hoursSummary.ts`, che fa la
 * stessa unione partendo dalle righe delle ore.
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
 * mostrarne uno solo sarebbe una bugia detta con sicurezza. In quel caso la riga
 * omette il chip e il dettaglio resta nella scheda.
 */
export function personEmploymentType(
  person: OwnerPerson
): StaffMember["employment_type"] | null {
  const open = person.memberships.filter((m) => !m.venue?.closed_at);
  if (open.length === 0) return null;
  const first = open[0].employment_type;
  return open.every((m) => m.employment_type === first) ? first : null;
}

/**
 * Tutte le persone dell'organico del titolare, **attraverso le sedi**.
 *
 * È **l'elenco dell'organico**: dal 14/09/2026 la tab Staff mostra questo e non
 * più le schede di una sede, perché l'organico è dell'azienda. Serve anche alla
 * chat, dove il thread è per persona.
 *
 * I ruoli arrivano nello stesso embed (`staff_member_roles → venue_roles`) e non
 * da una query in più: è il frammento che `getVenueStaff` usa già, e
 * l'annidamento a quattro livelli è quello di `getStaffPerson`. Senza, ogni riga
 * dell'elenco resterebbe senza mansione o costerebbe una query per persona.
 */
export async function getOwnerPeople(ownerId: string): Promise<OwnerPerson[]> {
  const { data, error } = await supabase
    .from("staff_people")
    .select(
      "*, waiter:profiles!staff_people_waiter_id_fkey(id, full_name, avatar_url), " +
        "memberships:staff_members(id, venue_id, link_status, employment_type, " +
        "venue:venues(id, name, city, closed_at), " +
        "staff_member_roles(role:venue_roles(id, name, sort_order)))"
    )
    .eq("owner_id", ownerId)
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  // `as unknown`: su questo embed a quattro livelli PostgREST non riesce a
  // inferire il tipo e il cast diretto non si sovrappone. Stessa scorciatoia di
  // `shifts/api.ts` sugli embed annidati.
  const people = (data as unknown as OwnerPerson[] | null) ?? [];

  // Le appartenenze finite restano nel database (sono lo storico), ma **questo**
  // è l'elenco dell'organico: chi se n'è andato non ha un chip di sede, non
  // porta i suoi ruoli nella riga e, se non lavora più da nessuna parte, non
  // compare. La sua scheda resta raggiungibile da Ore e dallo storico, dove
  // `getStaffPerson` le appartenenze finite le mostra apposta.
  return people
    .map((p) => ({
      ...p,
      memberships: p.memberships.filter((m) => m.link_status !== "left"),
    }))
    .filter((p) => p.memberships.length > 0);
}

/**
 * L'appartenenza finita che c'è già per quella persona in quella sede, se c'è.
 *
 * ⚠️ Da quando uscire è `link_status = 'left'` e non un delete, riaggiungere
 * qualcuno che se n'era andato **non può** essere una insert: l'unique
 * `staff_members_venue_person_uq (venue_id, person_id)` la rifiuterebbe, con un
 * 23505 in faccia a chi voleva solo riprendere Marco per l'estate. Si rianima la
 * riga di prima, e lo storico di quella sede torna attaccato alla persona senza
 * un buco in mezzo.
 */
async function findLeftMembership(
  venueId: string,
  personId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("id")
    .eq("venue_id", venueId)
    .eq("person_id", personId)
    .eq("link_status", "left")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** Rimette in organico un'appartenenza chiusa. `left_at` torna a null. */
async function reviveMembership(
  id: string,
  fields: Pick<TablesInsert<"staff_members">, "employment_type" | "link_status">
): Promise<StaffMember> {
  const { data, error } = await supabase
    .from("staff_members")
    .update({
      link_status: fields.link_status ?? "active",
      employment_type: fields.employment_type,
      left_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Aggiunge a una sede una persona che il titolare **ha già** (perché lavora in
 * un'altra delle sue sedi). Nessun invito: l'account, se c'è, è già collegato
 * alla persona e il trigger lo copia sulla scheda nuova.
 *
 * Se in quella sede c'era già stata e se n'era andata, si riprende quella riga
 * invece di crearne una seconda — vedi `findLeftMembership`.
 */
export async function addPersonToVenue(
  input: TablesInsert<"staff_members">
): Promise<StaffMember> {
  const left = await findLeftMembership(input.venue_id, input.person_id);
  if (left) return reviveMembership(left, input);

  const { data, error } = await supabase
    .from("staff_members")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Persona nuova + le sue prime appartenenze, in due scritture.
 *
 * Si aggiunge una **persona**, e le si dice in quali sedi lavora: dal 14/09/2026
 * non c'è più una sede attiva a cui "appartenere", quindi il form chiede le sedi
 * come chiede il nome.
 *
 * Se l'account è **già** una persona di questo titolare (lavora in un'altra sede)
 * si riusa quella: l'unique `staff_people (owner_id, waiter_id)` rifiuterebbe una
 * seconda anagrafica, e sarebbe comunque sbagliato crearla — è lo stesso Marco.
 *
 * Le appartenenze vanno in **una** insert di N righe: o passano tutte o non passa
 * nessuna, e non resta una persona in due sedi su tre senza che nessuno lo dica.
 * Se quella scrittura fallisce si cancella la persona appena creata: senza la
 * compensazione resterebbe una persona senza sedi, che nessuna schermata elenca e
 * che occuperebbe il posto nell'unique — il prossimo tentativo di invitare la
 * stessa email fallirebbe senza una ragione visibile. Stessa regola di
 * `createStaffDocument`.
 */
export async function addStaffToVenues(args: {
  ownerId: string;
  venueIds: string[];
  fullName: string;
  employmentType: Enums<"employment_type">;
  phone?: string | null;
  waiterId?: string | null;
  linkStatus?: Enums<"staff_link_status">;
}): Promise<StaffMember[]> {
  if (args.venueIds.length === 0) {
    throw new Error("Scegli almeno una sede.");
  }

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

  const person = personId;

  // Le sedi in cui questa persona era già stata e se n'era andata: lì si
  // rianima la riga di prima, perché l'unique (venue_id, person_id) non ne
  // ammette una seconda. Vedi `findLeftMembership`.
  const { data: leftRows, error: leftError } = await supabase
    .from("staff_members")
    .select("id, venue_id")
    .eq("person_id", person)
    .eq("link_status", "left")
    .in("venue_id", args.venueIds);
  if (leftError) {
    if (created) await supabase.from("staff_people").delete().eq("id", person);
    throw new Error(leftError.message);
  }
  const leftByVenue = new Map((leftRows ?? []).map((r) => [r.venue_id, r.id]));
  const toInsert = args.venueIds.filter((v) => !leftByVenue.has(v));

  const revived: StaffMember[] = [];
  for (const [, id] of leftByVenue) {
    revived.push(
      await reviveMembership(id, {
        employment_type: args.employmentType,
        ...(args.linkStatus ? { link_status: args.linkStatus } : {}),
      })
    );
  }

  if (toInsert.length === 0) return revived;

  const { data: members, error } = await supabase
    .from("staff_members")
    .insert(
      toInsert.map((venue_id) => ({
        venue_id,
        person_id: person,
        employment_type: args.employmentType,
        ...(args.linkStatus ? { link_status: args.linkStatus } : {}),
      }))
    )
    .select("*");

  if (error) {
    if (created) {
      await supabase.from("staff_people").delete().eq("id", person);
    }
    throw new Error(error.message);
  }
  return [...revived, ...(members ?? [])];
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

/**
 * Il titolare toglie una persona dall'organico di una sede.
 *
 * ⚠️ **Non è un delete.** Lo era, e portava via per cascata tutte le
 * `shift_assignments` di quella sede — ore lavorate comprese, cioè il riepilogo
 * che va al commercialista. Ora la RPC `remove_staff_member` (20260914102811)
 * mette `link_status = 'left'`: lo storico resta, i turni futuri vengono
 * annullati e contati nella notifica al professionista.
 */
export async function removeStaffMember(id: string): Promise<void> {
  const { error } = await supabase.rpc("remove_staff_member", {
    p_staff_id: id,
  });
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
