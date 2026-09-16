import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { addDaysToDate, todayString } from "@/lib/format";
import { monthBounds } from "@/features/assignments/api";
import type { Enums, Tables } from "@/types/database";
import type { AbsenceSummaryRow } from "./summary";

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

/** Quanto indietro guarda la pagina Assenze. */
export const COMPANY_ABSENCES_DAYS_BACK = 60;

/**
 * Chi gestisce l'organico: le assenze di tutta l'azienda per la pagina
 * Assenze. Le richieste ancora da decidere tutte, qualunque data abbiano; le
 * altre solo se non sono finite da più di `COMPANY_ABSENCES_DAYS_BACK` giorni.
 *
 * Una finestra e non lo storico intero: la pagina risponde a «chi manca in
 * questi giorni», e lo storico di ogni persona sta nella sua scheda. La RLS
 * (`manager read`) limita alle persone gestite con il permesso Organico.
 */
export async function getCompanyAbsences(): Promise<AbsenceWithPerson[]> {
  const since = addDaysToDate(todayString(), -COMPANY_ABSENCES_DAYS_BACK);
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*, person:staff_people(id, full_name, waiter_id)")
    .or(`status.eq.pending,end_date.gte.${since}`)
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as AbsenceWithPerson[] | null) ?? [];
}

/**
 * Un'assenza vista dal planning: date, orari e stato, **mai il tipo**. La
 * restituisce `get_absence_availability` (migration 20260918110000) anche a chi
 * fa solo i turni e non può leggere `staff_absences`.
 */
export type AbsenceAvailability = {
  id: string;
  person_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  status: AbsenceStatus;
};

export async function getAbsenceAvailability(
  from: string,
  to: string
): Promise<AbsenceAvailability[]> {
  const { data, error } = await supabase.rpc("get_absence_availability", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  // I generatori di tipi danno per `not null` ogni colonna di una `returns
  // table`: gli orari invece sono null su tutte le assenze a giornata intera.
  return (data ?? []) as AbsenceAvailability[];
}

/** Un turno attivo di una persona, per i conflitti con un'assenza. */
export type PersonShiftAssignment = {
  /** L'assegnazione: è la riga che si toglie. */
  id: string;
  shift: {
    id: string;
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    venue_id: string;
  };
};

/**
 * I turni attivi (assegnati o confermati, non annullati) di una persona fra due
 * date, su tutte le sedi.
 *
 * `from` parte dal giorno prima: un turno notturno cominciato la sera prima
 * delle ferie finisce dentro le ferie. Il filtro esatto lo fa `absenceConflicts`.
 *
 * La RLS restituisce solo i turni delle sedi in cui l'utente gestisce i turni:
 * un delegato con il solo Organico vede l'assenza ma non i conflitti, e non
 * potrebbe comunque toglierli.
 */
export async function getPersonShiftsInRange(
  personId: string,
  from: string,
  to: string
): Promise<PersonShiftAssignment[]> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "id, staff_member:staff_members!inner(person_id), shift:shifts!inner(id, title, date, start_time, end_time, venue_id, status)"
    )
    .eq("staff_member.person_id", personId)
    .in("status", ["assigned", "confirmed"])
    .gte("shift.date", addDaysToDate(from, -1))
    .lte("shift.date", to)
    .neq("shift.status", "cancelled");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((a) => ({
      id: a.id,
      shift: {
        id: a.shift.id,
        title: a.shift.title,
        date: a.shift.date,
        start_time: a.shift.start_time,
        end_time: a.shift.end_time,
        venue_id: a.shift.venue_id,
      },
    }))
    .sort((a, b) =>
      `${a.shift.date}T${a.shift.start_time}`.localeCompare(
        `${b.shift.date}T${b.shift.start_time}`
      )
    );
}

/**
 * Toglie la persona dai turni in conflitto con l'assenza.
 *
 * Una `delete` sulle assegnazioni, come fa già la modifica di un turno: il
 * trigger `notify_on_assignment_removed` avvisa chi esce («Turno revocato») e
 * quello sui coperti riapre il posto. Il turno resta, scoperto: il sostituto lo
 * sceglie il titolare.
 */
export async function removeFromShifts(assignmentIds: string[]): Promise<void> {
  if (assignmentIds.length === 0) return;
  const { error } = await supabase
    .from("shift_assignments")
    .delete()
    .in("id", assignmentIds);
  if (error) throw new Error(error.message);
}

/**
 * Le assenze approvate del mese per persona, per la pagina Ore e l'export.
 * Stesso intervallo di `getOwnerHoursSummary` (fine esclusa). Il perimetro è il
 * permesso Ore, e lo decide la RPC (`auth.uid()`).
 */
export async function getOwnerAbsenceSummary(
  month: string
): Promise<AbsenceSummaryRow[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase.rpc("get_owner_absence_summary", {
    p_from: start,
    p_to: end,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as AbsenceSummaryRow[]).map((r) => ({
    ...r,
    // `numeric` arriva come stringa o numero a seconda del valore.
    permesso_hours: Number(r.permesso_hours),
  }));
}
