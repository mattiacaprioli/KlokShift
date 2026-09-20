import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { addDaysToDate, todayString } from "@/lib/format";
import { monthBounds } from "@/features/assignments/api";
import type { Membership } from "@/features/workspace/types";
import type { Enums, Tables } from "@/types/database";
import type { AbsenceSummaryRow } from "./summary";

export type Absence = Tables<"staff_absences">;
export type AbsenceKind = Enums<"absence_kind">;
export type AbsenceStatus = Enums<"absence_status">;

/**
 * Un'assenza con il nome della persona: le liste di chi gestisce l'organico.
 * `person.id` è il member id (`workspace_members.id`), come `Absence.member_id`.
 */
export type AbsenceWithPerson = Absence & {
  person: { id: string; full_name: string; waiter_id: string | null } | null;
};

/**
 * Un datore di lavoro a cui il professionista può mandare una richiesta: una
 * sua appartenenza attiva con almeno una sede in cui è in organico.
 */
export type AbsenceEmployer = {
  /** La mia appartenenza (`workspace_members.id`): è a cui si riferisce l'assenza. */
  memberId: string;
  /** L'azienda a cui si chiede (`p_workspace`). */
  workspaceId: string;
  /** I nomi delle sedi, come `documentScopeLabel`. */
  label: string;
};

/** Le aziende a cui chiedere un'assenza, ricavate dalle mie appartenenze. */
export function absenceEmployersOf(memberships: Membership[]): AbsenceEmployer[] {
  return memberships
    .filter((m) => m.status === "active" && m.works.length > 0)
    .map((m) => {
      const names = [...new Set(m.works.map((w) => w.venue_name))].sort((a, b) =>
        a.localeCompare(b, "it")
      );
      return {
        memberId: m.member_id,
        workspaceId: m.workspace_id,
        label: names.length > 0 ? names.join(" · ") : "Sede",
      };
    });
}

/** Le colonne della persona che accompagnano un'assenza, con la forma di `AbsenceWithPerson`. */
const PERSON_EMBED = "person:workspace_members(id, display_name, user_id)";

type PersonEmbed = { id: string; display_name: string; user_id: string | null } | null;

function withPerson<T extends { person: PersonEmbed }>(
  rows: T[] | null
): AbsenceWithPerson[] {
  return (rows ?? []).map(({ person, ...absence }) => ({
    ...(absence as unknown as Absence),
    person: person
      ? { id: person.id, full_name: person.display_name, waiter_id: person.user_id }
      : null,
  }));
}

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
  input: AbsenceInput & { workspaceId: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("request_absence", {
    p_workspace: input.workspaceId,
    ...absenceArgs(input),
  });
  if (error) throw new UserFacingError(error.message);
  return data as string;
}

/** Titolare o delegato con l'organico: registra un'assenza già approvata. */
export async function recordAbsence(
  input: AbsenceInput & { memberId: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("record_absence", {
    p_member: input.memberId,
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
 * Professionista: le sue assenze presso tutte le aziende. La RLS restituisce
 * già solo quelle delle sue appartenenze; il filtro rende esplicita la richiesta.
 */
export async function getMyAbsences(waiterId: string): Promise<Absence[]> {
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*, member:workspace_members!inner(user_id)")
    .eq("member.user_id", waiterId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ member: _member, ...absence }) => absence);
}

/** Chi gestisce l'organico: le assenze di una persona, dalla più recente. */
export async function getPersonAbsences(memberId: string): Promise<Absence[]> {
  const { data, error } = await supabase
    .from("staff_absences")
    .select("*")
    .eq("member_id", memberId)
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
    .select(`*, ${PERSON_EMBED}`)
    .or(
      `status.eq.pending,and(kind.eq.malattia,status.eq.approved,requested_by.not.is.null,created_at.gte.${since})`
    )
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return withPerson(data);
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
    .select(`*, ${PERSON_EMBED}`)
    .or(`status.eq.pending,end_date.gte.${since}`)
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return withPerson(data);
}

/**
 * Un'assenza vista dal planning: date, orari e stato, **mai il tipo**. La
 * restituisce `get_absence_availability` (migration 20260918110000) anche a chi
 * fa solo i turni e non può leggere `staff_absences`.
 */
export type AbsenceAvailability = {
  id: string;
  /** La persona (`workspace_members.id`). */
  member_id: string;
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
  memberId: string,
  from: string,
  to: string
): Promise<PersonShiftAssignment[]> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "id, venue_member:venue_members!inner(member_id), shift:shifts!inner(id, title, date, start_time, end_time, venue_id, status)"
    )
    .eq("venue_member.member_id", memberId)
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
 * Una `unassign` per assegnazione, come fa già la modifica di un turno: chi
 * esce riceve l'avviso («Turno revocato») e il posto si riapre. Il turno
 * resta, scoperto: il sostituto lo sceglie il titolare. Si ferma al primo
 * errore, senza ingoiarlo.
 */
export async function removeFromShifts(assignmentIds: string[]): Promise<void> {
  for (const id of assignmentIds) {
    const { error } = await supabase.rpc("unassign", { p_assignment: id });
    if (error) throw new UserFacingError(error.message);
  }
}

/**
 * Le assenze approvate del mese per persona, per la pagina Ore e l'export.
 * Stesso intervallo di `get_hours_summary` (fine esclusa). Il perimetro è il
 * permesso Ore, e lo decide la RPC (`auth.uid()`).
 */
export async function getOwnerAbsenceSummary(
  month: string
): Promise<AbsenceSummaryRow[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase.rpc("get_absence_summary", {
    p_from: start,
    p_to: end,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    person_id: r.member_id,
    person_name: r.member_name,
    ferie_days: r.ferie_days,
    permesso_days: r.permesso_days,
    // `numeric` arriva come stringa o numero a seconda del valore.
    permesso_hours: Number(r.permesso_hours),
    malattia_days: r.malattia_days,
    // Il generatore lo dà `not null`, ma è null se non ci sono malattie.
    inps_protocols: (r.inps_protocols as string | null) ?? null,
  }));
}
