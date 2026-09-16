import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { addDaysToDate, todayString } from "@/lib/format";
import type { Enums, Tables } from "@/types/database";

export type Absence = Tables<"staff_absences">;
export type AbsenceKind = Enums<"absence_kind">;
export type AbsenceStatus = Enums<"absence_status">;

/** Un'assenza con il nome della persona: le liste di chi gestisce l'organico. */
export type AbsenceWithPerson = Absence & {
  person: Pick<Tables<"staff_people">, "id" | "full_name" | "waiter_id"> | null;
};

/**
 * Un datore di lavoro a cui il professionista può mandare una richiesta: una
 * riga di `staff_people` con almeno una sede in cui è in organico attivo.
 */
export type AbsenceEmployer = {
  personId: string;
  ownerId: string;
  /** I nomi delle sedi, come `documentScopeLabel`. */
  label: string;
};

/**
 * Ferie, permessi e malattia (migration 20260918100200).
 *
 * La tabella è in sola lettura per tutti: si scrive solo dalle RPC `security
 * definer`, come le richieste di cambio turno. Gli errori delle RPC sono frasi
 * scritte per essere lette («C'è già un'assenza in quelle date»), quindi
 * `UserFacingError`.
 *
 * ⚠️ Malattia = dato sanitario. Per la malattia si mandano solo le date e il
 * protocollo INPS: la nota non si manda nemmeno se il form ne avesse una.
 */
export type AbsenceInput = {
  kind: AbsenceKind;
  /** "YYYY-MM-DD" */
  startDate: string;
  endDate: string;
  /** Solo per un permesso a ore, "HH:MM". */
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
  inpsProtocol?: string | null;
};

function absenceArgs(input: AbsenceInput) {
  const sick = input.kind === "malattia";
  const hourly = input.kind === "permesso" && !!input.startTime && !!input.endTime;
  return {
    p_kind: input.kind,
    p_start: input.startDate,
    p_end: hourly ? input.startDate : input.endDate,
    p_start_time: hourly ? (input.startTime ?? undefined) : undefined,
    p_end_time: hourly ? (input.endTime ?? undefined) : undefined,
    p_note: sick ? undefined : input.note?.trim() || undefined,
    p_inps_protocol: sick ? input.inpsProtocol?.trim() || undefined : undefined,
  };
}

/** Professionista: chiede ferie o un permesso, o comunica una malattia. */
export async function requestAbsence(
  input: AbsenceInput & { ownerId: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("request_absence", {
    p_owner: input.ownerId,
    ...absenceArgs(input),
  });
  if (error) throw new UserFacingError(error.message);
  return data as string;
}

/** Titolare o delegato con l'organico: registra un'assenza già approvata. */
export async function recordAbsence(
  input: AbsenceInput & { personId: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("record_absence", {
    p_person: input.personId,
    ...absenceArgs(input),
  });
  if (error) throw new UserFacingError(error.message);
  return data as string;
}

export async function resolveAbsence(input: {
  absenceId: string;
  approve: boolean;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("resolve_absence", {
    p_absence: input.absenceId,
    p_approve: input.approve,
    p_note: input.note?.trim() || undefined,
  });
  if (error) throw new UserFacingError(error.message);
}

export async function withdrawAbsence(absenceId: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_absence", {
    p_absence: absenceId,
  });
  if (error) throw new UserFacingError(error.message);
}

export async function setAbsenceInpsProtocol(input: {
  absenceId: string;
  protocol: string;
}): Promise<void> {
  const { error } = await supabase.rpc("set_absence_inps_protocol", {
    p_absence: input.absenceId,
    p_protocol: input.protocol.trim(),
  });
  if (error) throw new UserFacingError(error.message);
}

/** Un'assenza per id: è quanto serve alla card dentro il thread di chat. */
export async function getAbsence(absenceId: string): Promise<Absence | null> {
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*")
    .eq("id", absenceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Professionista: le sue assenze presso tutti i datori di lavoro. La RLS
 * (`requester read`) restituisce già solo quelle delle sue `staff_people`.
 */
export async function getMyAbsences(waiterId: string): Promise<Absence[]> {
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*, person:staff_people!inner(waiter_id)")
    .eq("person.waiter_id", waiterId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ person: _person, ...absence }) => absence);
}

/** Professionista: a chi può chiedere un'assenza (organico attivo). */
export async function getMyAbsenceEmployers(
  waiterId: string
): Promise<AbsenceEmployer[]> {
  const { data, error } = await supabase
    .from("staff_people")
    .select(
      "id, owner_id, memberships:staff_members!inner(link_status, venue:venues(name))"
    )
    .eq("waiter_id", waiterId)
    .eq("memberships.link_status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => {
    const names = p.memberships
      .map((m) => m.venue?.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b, "it"));
    return {
      personId: p.id,
      ownerId: p.owner_id,
      label: names.length > 0 ? names.join(" · ") : "Sede",
    };
  });
}

/** Chi gestisce l'organico: le assenze di una persona, dalla più recente. */
export async function getPersonAbsences(personId: string): Promise<Absence[]> {
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*")
    .eq("person_id", personId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Quanto resta «da vedere» una malattia comunicata, nella home. */
const RECENT_SICK_DAYS = 7;

/**
 * Chi gestisce l'organico: le richieste da decidere e le malattie comunicate di
 * recente (che non si decidono, ma vanno viste per trovare chi copre).
 *
 * La RLS (`manager read`) limita alle persone che l'utente gestisce con il
 * permesso Organico. Le malattie registrate dal titolare stesso restano fuori
 * (`requested_by` null): le sa già.
 */
export async function getAbsencesToHandle(): Promise<AbsenceWithPerson[]> {
  const since = addDaysToDate(todayString(), -RECENT_SICK_DAYS);
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*, person:staff_people(id, full_name, waiter_id)")
    .or(
      `status.eq.pending,and(kind.eq.malattia,status.eq.approved,requested_by.not.is.null,created_at.gte.${since})`
    )
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as AbsenceWithPerson[] | null) ?? [];
}
