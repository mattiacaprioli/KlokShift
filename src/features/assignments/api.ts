import { supabase } from "@/lib/supabase";
import {
  addDaysToDate,
  isShiftOver,
  shiftSortKey,
  todayString,
} from "@/lib/format";
import type { Enums, Tables } from "@/types/database";
import type { Shift, ShiftWithVenue } from "@/features/shifts/types";
import type {
  StaffMember,
  StaffRoleRef,
} from "@/features/staff/types";
import { isActiveAssignment } from "./status";
import type { OwnerHoursRow } from "./hoursSummary";
import {
  effectiveClockTimes,
  type ClockRecordWithCorrections,
} from "@/features/clock/hours";
import {
  toStaffMember,
  VENUE_MEMBER_BY_ACCOUNT,
  VENUE_MEMBER_FULL,
  VENUE_MEMBER_WITH_RATING,
} from "./embeds";

export type Assignment = Tables<"shift_assignments">;

const CLOCK_EMBED =
  "clock:shift_clock_records(*, corrections:shift_clock_corrections(*, corrector:profiles(full_name)))";

function activeClock(
  rows: ClockRecordWithCorrections[] | null | undefined
): ClockRecordWithCorrections | null {
  return rows?.find((row) => row.voided_at == null) ?? null;
}

/** Waiter side: an assignment joined with its shift + venue. */
export type AssignmentWithShift = Assignment & {
  shift: ShiftWithVenue | null;
  /** In che ruolo è chiamato: è ciò che vuole sapere prima di confermare. */
  role: { id: string; name: string } | null;
  /** Null = usa il metodo predefinito della sede. */
  clock_method: Enums<"clock_method"> | null;
  clock: ClockRecordWithCorrections | null;
};

type WaiterMini = Pick<Tables<"profiles">, "id" | "full_name" | "avatar_url">;

/**
 * Assignment + la persona in organico (e il suo account, se ce l'ha).
 *
 * La chiave resta `staff_member`: è la riga di organico (`venue_members`) letta
 * nella forma `StaffMember`, con nome e account che stanno sulla persona.
 * L'assegnazione punta a lei con `venue_member_id`.
 */
export type AssignmentWithStaff = Assignment & {
  /** Il ruolo ricoperto su questo turno, non le mansioni della scheda. */
  role: { id: string; name: string } | null;
  clock: ClockRecordWithCorrections | null;
  staff_member:
    | (StaffMember & {
        /** Null = eredita il metodo della sede. */
        clock_method: Enums<"clock_method"> | null;
        waiter: WaiterMini | null;
        staff_member_roles: { role: StaffRoleRef | null }[];
      })
    | null;
};

/** Today's internal-shift assignment, with staff + rating + shift slot (home). */
export type TodayAssignmentRow = Assignment & {
  /** Il ruolo di quel giorno: è la risposta alla domanda che la card pone. */
  role: { id: string; name: string } | null;
  clock: ClockRecordWithCorrections | null;
  staff_member:
    | (StaffMember & {
        /** Null = eredita il metodo della sede. */
        clock_method: Enums<"clock_method"> | null;
        waiter:
          | (WaiterMini & {
              waiter_profile: {
                rating_avg: number;
                rating_count: number;
              } | null;
            })
          | null;
      })
    | null;
  shift: Pick<
    Shift,
    "id" | "title" | "date" | "start_time" | "end_time" | "venue_id"
  > | null;
};

/**
 * Una persona su un turno, col ruolo che ricopre **quel giorno**.
 *
 * `venue_member_id` è la riga di organico (`venue_members.id`), non la persona.
 * `role_id` null non è un errore: chi ha più mansioni e non ne ha ancora scelta
 * una resta assegnato ma non copre nessun fabbisogno, cioè esattamente quello
 * che succede nella realtà finché non lo si decide. (Con una sola mansione lo
 * riempie il trigger `default_assignment_role`.)
 */
export type StaffAssignmentInput = {
  venue_member_id: string;
  role_id: string | null;
};

/** Fabbisogno per ruolo così come lo scrivono i form. */
export type RoleTargetInput = { role_id: string; count: number };

/**
 * La "ricetta" di un turno interno: campi, fabbisogno per ruolo e chi ci lavora.
 * È quanto serve per **riprodurlo altrove** senza rimetterlo a mano — duplicare
 * una settimana, ripetere lo stesso turno su più giorni.
 */
export type InternalShiftPlan = {
  /**
   * ⚠️ La sede sta **sul piano**, non sulla chiamata.
   *
   * Con il planning unificato, duplicare una settimana che contiene Roma e
   * Milano spingerebbe tutti i turni in una sede sola — e il compilatore non se
   * ne accorgerebbe mai, perché sono entrambe stringhe.
   *
   * Anche `venue_member_id` e `role_id` sono legati alla sede del turno che ha
   * generato il piano: il server rifiuta (`not_in_roster`, `role_not_in_venue`)
   * chi non è in organico o un ruolo che non è di quella sede.
   */
  venue_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  description: string | null;
  /**
   * Chiede la conferma anche ai dipendenti fissi (default: no). Di norma lo
   * stato iniziale di ogni assegnazione lo decide il database guardando
   * `venue_members.employment_type`: il fisso nasce già `confirmed`, chi è a
   * chiamata deve rispondere. Questo flag è l'eccezione per il singolo turno —
   * straordinario, festivo — e vale per tutti. Fa parte della ricetta.
   */
  require_confirmation: boolean;
  roleTargets: RoleTargetInput[];
  staff: StaffAssignmentInput[];
};

/** Un piano come lo vuole la RPC `create_shifts` (`role_targets`, non `roleTargets`). */
function planPayload(p: InternalShiftPlan) {
  return {
    venue_id: p.venue_id,
    title: p.title,
    description: p.description,
    date: p.date,
    start_time: p.start_time,
    end_time: p.end_time,
    require_confirmation: p.require_confirmation,
    role_targets: p.roleTargets.filter((t) => t.count > 0),
    staff: p.staff,
  };
}

/**
 * Crea più turni interni **in una sola chiamata**, tutto o niente: la RPC
 * `create_shifts` scrive turni, fabbisogni e assegnazioni nella stessa
 * transazione e calcola i posti. Un errore (persona fuori organico, ruolo di
 * un'altra sede, permesso mancante) non lascia niente a metà.
 *
 * I trigger DB fanno il resto: ogni assegnato riceve la sua notifica.
 * Ritorna gli id dei turni creati, nell'ordine dei piani.
 */
export async function createInternalShifts(
  plans: InternalShiftPlan[]
): Promise<string[]> {
  if (plans.length === 0) return [];
  const { data, error } = await supabase.rpc("create_shifts", {
    p_plans: plans.map(planPayload),
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Crea un turno interno e lo assegna alle persone indicate. */
export async function createInternalShift(
  input: Omit<InternalShiftPlan, "require_confirmation" | "roleTargets"> & {
    /** Fabbisogno per ruolo (es. 2 Cameriere + 1 Sommelier). */
    roleTargets?: RoleTargetInput[];
    require_confirmation?: boolean;
  }
): Promise<string> {
  const [id] = await createInternalShifts([
    {
      ...input,
      roleTargets: input.roleTargets ?? [],
      require_confirmation: input.require_confirmation ?? false,
    },
  ]);
  return id;
}

/** Legge i turni indicati e ne ricava i piani riproducibili. */
export async function getInternalShiftPlans(
  shiftIds: string[]
): Promise<InternalShiftPlan[]> {
  if (shiftIds.length === 0) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "venue_id, title, date, start_time, end_time, description, require_confirmation, shift_role_requirements(role_id, count), shift_assignments(venue_member_id, role_id, status)"
    )
    .in("id", shiftIds)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    venue_id: s.venue_id,
    title: s.title,
    date: s.date,
    start_time: s.start_time,
    end_time: s.end_time,
    description: s.description,
    require_confirmation: s.require_confirmation,
    roleTargets: (s.shift_role_requirements ?? []).map((r) => ({
      role_id: r.role_id,
      count: r.count,
    })),
    // Chi ha rifiutato o è risultato assente **non** va ricopiato: il piano
    // riproduce chi era previsto al lavoro, non la cronaca di quel giorno.
    // Il ruolo viaggia con la persona: copiare "Marco" senza "come barman"
    // creerebbe una settimana di turni scoperti.
    staff: (s.shift_assignments ?? [])
      .filter((a) => isActiveAssignment(a.status))
      .map((a) => ({
        venue_member_id: a.venue_member_id,
        role_id: a.role_id,
      })),
  }));
}

/**
 * Modifica completa di un turno interno: campi base, fabbisogno per ruolo e
 * persone assegnate. Una sola RPC (`update_shift`), atomica: il server fa il
 * diff delle assegnazioni (i nuovi ricevono la notifica, i rimossi escono, chi
 * resta cambia ruolo) e ricalcola i posti. Se giorno o orario cambiano avvisa
 * gli assegnati e riapre la conferma.
 */
export async function updateInternalShift(
  shiftId: string,
  input: {
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    description: string | null;
    /** Vedi `InternalShiftPlan.require_confirmation`. */
    require_confirmation: boolean;
    roleTargets: RoleTargetInput[];
    staff: StaffAssignmentInput[];
  }
): Promise<void> {
  const { roleTargets, staff, ...fields } = input;
  const { error } = await supabase.rpc("update_shift", {
    p_shift: shiftId,
    p_payload: {
      ...fields,
      role_targets: roleTargets.filter((t) => t.count > 0),
      staff,
    },
  });
  // Le eccezioni della RPC (`finished_shift_locked`, `not_in_roster`…) sono
  // tradotte da `userErrorMessage`: il messaggio grezzo ne conserva il codice.
  if (error) throw new Error(error.message);
}

export type ShiftRoleRequirement = Tables<"shift_role_requirements"> & {
  role: { id: string; name: string; sort_order: number } | null;
};

/** Fabbisogno per ruolo di un turno, col nome del ruolo per l'etichetta. */
export async function getShiftRoleRequirements(
  shiftId: string
): Promise<ShiftRoleRequirement[]> {
  const { data, error } = await supabase
    .from("shift_role_requirements")
    .select("*, role:venue_roles(id, name, sort_order)")
    .eq("shift_id", shiftId);
  if (error) throw new Error(error.message);
  return ((data as ShiftRoleRequirement[] | null) ?? []).sort(
    (a, b) => (a.role?.sort_order ?? 0) - (b.role?.sort_order ?? 0)
  );
}

export async function getShiftAssignments(
  shiftId: string
): Promise<AssignmentWithStaff[]> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(`*, role:venue_roles(id, name), ${CLOCK_EMBED}, ${VENUE_MEMBER_FULL}`)
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ venue_member, clock, ...row }) => ({
    ...row,
    clock: activeClock(clock as ClockRecordWithCorrections[]),
    staff_member: venue_member ? toStaffMember(venue_member) : null,
  }));
}

/**
 * Il professionista conferma o rifiuta il **proprio** turno (RPC
 * `respond_assignment`). Ritorna la riga aggiornata: un turno finito o
 * annullato, o non suo, è un errore e non un 200 muto.
 */
export async function respondToAssignment(
  id: string,
  status: Extract<Enums<"assignment_status">, "confirmed" | "declined">
): Promise<Assignment> {
  const { data, error } = await supabase.rpc("respond_assignment", {
    p_assignment: id,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Aggiunge una persona (riga di organico) a un turno, nel ruolo indicato. */
export async function assignToShift(
  shiftId: string,
  venueMemberId: string,
  roleId?: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc("assign", {
    p_shift: shiftId,
    p_venue_member: venueMemberId,
    p_role: roleId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Toglie una persona dal turno. */
export async function unassignFromShift(assignmentId: string): Promise<void> {
  const { error } = await supabase.rpc("unassign", {
    p_assignment: assignmentId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Passa un'assegnazione a un'altra persona della stessa sede.
 *
 * Cancella e ricrea nella stessa transazione (RPC `reassign`): solo così
 * scattano entrambe le notifiche — «Turno revocato» a chi esce, «Nuovo turno
 * assegnato» a chi entra — e chi entra non eredita lo stato (magari
 * "confermato") né le ore di chi esce.
 *
 * `toVenueMemberId` è una riga di organico (`StaffMember.id`), non una persona.
 * Ritorna l'id della nuova riga.
 */
export async function reassignShiftAssignment(
  assignmentId: string,
  toVenueMemberId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("reassign", {
    p_assignment: assignmentId,
    p_to_venue_member: toVenueMemberId,
  });
  // Le eccezioni della RPC (`not_in_roster`, `already_assigned`…) hanno la loro
  // frase italiana in `userErrorMessage`: il messaggio grezzo ne porta il codice.
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Sposta **una persona** da un turno a un altro, lasciando dov'è il resto della
 * squadra. È `reassignShiftAssignment` ribaltata: lì cambia la persona e resta
 * il turno, qui resta la persona e cambia il turno.
 *
 * `to` è un turno che esiste già quel giorno, oppure una data: in quel caso la
 * RPC crea il gemello del turno di partenza (stessa sede, stesso titolo, stessi
 * orari) e ci mette la persona. Stessa meccanica di `reassign` — delete e
 * insert nella stessa transazione — quindi partono «Turno revocato» e «Nuovo
 * turno assegnato», e la conferma non si eredita.
 *
 * Ritorna l'id della nuova riga di assegnazione.
 */
export async function moveAssignment(
  assignmentId: string,
  to: { shiftId: string } | { date: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("move_assignment", {
    p_assignment: assignmentId,
    p_to_shift: "shiftId" in to ? to.shiftId : undefined,
    p_to_date: "date" in to ? to.date : undefined,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Presenza a turno concluso: stato (presente/assente) e/o ore effettive.
 * Ritorna la riga scritta. Il DB può rifiutare (`not_allowed`: le proprie
 * presenze le segna solo il titolare; `status` chiede «Turni», `worked_hours`
 * chiede «Ore»): l'errore arriva qui e va mostrato, non ingoiato.
 */
export async function setAssignmentPresence(
  id: string,
  fields: { status?: Enums<"assignment_status">; worked_hours?: number | null }
): Promise<Assignment> {
  const { data, error } = await supabase.rpc("record_attendance", {
    p_assignment: id,
    p_patch: fields,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Statistiche di una **persona** dell'organico (il blocco "Questo mese" della
 * scheda). Sette numeri, calcolati dal database.
 *
 * Sono i numeri dell'**azienda**, non di una sede: chi lavora a Roma e a Milano
 * per lo stesso titolare ha un solo monte ore e una sola affidabilità. Prima
 * l'aggregazione era per appartenenza, e un'assenza fatta a Milano non scalfiva
 * il 100% di Roma (20260913110100).
 *
 * Prima ancora, le due sezioni condividevano una query che scaricava **l'intera
 * storia di assegnazioni** per sommarla in JS — e ne mostrava sei righe.
 */
export type StaffPerformance = {
  past_total: number;
  worked_count: number;
  no_show_count: number;
  declined_count: number;
  total_hours: number;
  month_shifts: number;
  month_hours: number;
};

export async function getPersonPerformance(
  memberId: string
): Promise<StaffPerformance | null> {
  const { data, error } = await supabase
    .rpc("get_member_performance", { p_member: memberId })
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Ultimi turni svolti dalla persona, già ordinati e limitati dal database.
 *
 * Porta la **sede**: senza, due turni lo stesso giovedì alla stessa ora in due
 * sedi diverse sembrerebbero un doppione.
 */
export type StaffWorkedShift = {
  id: string;
  status: Enums<"assignment_status">;
  worked_hours: number | null;
  shift_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  /** Ore effettive: `worked_hours` se corretta a mano, altrimenti la durata. */
  hours: number;
  venue_id: string;
  venue_name: string;
};

export const STAFF_RECENT_SHIFTS = 6;

export async function getPersonWorkedShifts(
  memberId: string,
  limit = STAFF_RECENT_SHIFTS
): Promise<StaffWorkedShift[]> {
  const { data, error } = await supabase.rpc("get_member_worked_shifts", {
    p_member: memberId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Storico lavoro del professionista ("Le mie ore"): i turni svolti.
 *
 * La lista la fa il database (`get_my_work_history_page`). Il client non può
 * paginare da solo: l'ordinamento è per `shifts.date`, che sta in una tabella
 * collegata, e PostgREST non sa ordinare le righe padre per una colonna
 * dell'embed.
 */
export const WORK_HISTORY_PAGE_SIZE = 20;

/**
 * Da dove vengono le ore di una riga dello storico (`private.my_work_history`):
 * timbratura approvata, ore scritte da chi gestisce, timbratura ancora da
 * approvare, oppure l'orario del turno.
 */
export type WorkHoursSource = "approved" | "adjusted" | "pending" | "planned";

export type WorkHistoryRow = {
  key: string;
  venue_name: string | null;
  logo_url: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  shift_id: string;
  role_name: string | null;
  planned_hours: number;
  worked_hours: number | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  hours_source: WorkHoursSource | null;
};

export type WorkHistoryCursor = { date: string; key: string };

const WORK_HOURS_SOURCES: readonly string[] = [
  "approved",
  "adjusted",
  "pending",
  "planned",
] satisfies WorkHoursSource[];

/**
 * Il DB dichiara `hours_source` come `text`: qui si restringe all'enum. Un
 * valore che non si conosce (o che manca, da un database non ancora migrato)
 * diventa `null`, e la card non dice niente invece di dire una cosa sbagliata.
 */
function toWorkHistoryRow<T extends { hours_source: string | null }>(
  row: T
): Omit<T, "hours_source"> & { hours_source: WorkHoursSource | null } {
  return {
    ...row,
    hours_source: WORK_HOURS_SOURCES.includes(row.hours_source ?? "")
      ? (row.hours_source as WorkHoursSource)
      : null,
  };
}

export async function getMyWorkHistoryPage(
  cursor: WorkHistoryCursor | null
): Promise<WorkHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_my_work_history_page", {
    p_limit: WORK_HISTORY_PAGE_SIZE,
    p_before_date: cursor?.date,
    p_before_key: cursor?.key,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toWorkHistoryRow);
}

/**
 * Solo i due totali (turni svolti, ore). Esistono a parte perché la schermata
 * Profilo mostra **solo questi**: prima, per due numeri, scaricava tutto.
 */
export type WorkHistoryTotals = { total_count: number; total_hours: number };

export async function getMyWorkHistoryTotals(): Promise<WorkHistoryTotals> {
  const { data, error } = await supabase
    .rpc("get_my_work_history_totals")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? { total_count: 0, total_hours: 0 };
}

/** Lo storico fra `from` e `to` (inclusi, max 62 giorni), dal più recente. */
export async function getMyWorkHistoryRange(
  from: string,
  to: string
): Promise<WorkHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_my_work_history_range", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toWorkHistoryRow);
}

/** Come `getMyWorkHistoryTotals`, ma solo sui turni fra `from` e `to` (inclusi). */
export async function getMyWorkTotals(
  from: string,
  to: string
): Promise<WorkHistoryTotals> {
  const { data, error } = await supabase
    .rpc("get_my_work_totals", { p_from: from, p_to: to })
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? { total_count: 0, total_hours: 0 };
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${month}-01`,
    end: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  };
}

/**
 * Riepilogo ore di **tutta l'azienda** in un mese, righe (persona × sede).
 *
 * Le ore sono della persona, non della sede (20260913110100): chi fa 20 ore a Roma
 * e 20 a Milano per lo stesso titolare ha 40 ore e **una** busta paga. Il totale
 * per persona lo compone `groupHoursByPerson`; lo split per sede resta nelle righe
 * perché serve al titolare per allocare il costo del lavoro.
 *
 * L'aggregazione la fa il database. Prima scaricava ogni assegnazione del mese con
 * due join e sommava qui — e la pagina Ore offre dodici mesi a portata di click,
 * cioè dodici dataset completi.
 *
 * Il perimetro è l'intersezione fra l'azienda corrente e le sedi su cui chi
 * legge ha il permesso Ore. Le sedi chiuse restano incluse nello storico.
 */
export async function getOwnerHoursSummary(
  workspaceId: string,
  month: string
): Promise<OwnerHoursRow[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase.rpc("get_workspace_hours_summary", {
    p_workspace: workspaceId,
    p_from: start,
    p_to: end,
  });
  if (error) throw new Error(error.message);
  // La RPC parla di `member_*` (la persona = `workspace_members.id`): il resto
  // dell'app e gli export leggono ancora `person_*`, che è la stessa cosa.
  return (data ?? []).map(({ member_id, member_name, hours, approved_hours, ...row }) => ({
    ...row,
    person_id: member_id,
    person_name: member_name,
    planned_hours: hours,
    hours: approved_hours,
  }));
}

/**
 * Le due funzioni qui sotto filtravano per data **dopo** aver scaricato tutto:
 * ciascuna si portava a casa l'intera storia delle assegnazioni del
 * professionista e ne buttava via metà. Due query, lo stesso identico dataset
 * completo, due volte. Ora il filtro è server-side (`shift.date` sull'embed
 * `!inner`), quindi ognuna scarica solo la propria metà.
 *
 * L'ordinamento resta lato client di proposito: PostgREST ordina *dentro*
 * l'embed, non le righe padre, quindi un `order` su `shift.date` non farebbe
 * quello che sembra. Su insiemi già filtrati per data è irrilevante.
 */

/**
 * Waiter side: i prossimi turni assegnati. Conserva anche un turno appena
 * concluso se ha ancora un'entrata aperta: deve restare raggiungibile dalla
 * Home finché il professionista non timbra l'uscita.
 */
export async function getMyAssignedUpcoming(
  waiterId: string
): Promise<AssignmentWithShift[]> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      `*, role:venue_roles(id, name), ${CLOCK_EMBED}, ${VENUE_MEMBER_BY_ACCOUNT}, shift:shifts!inner(*, venue:venues(*))`
    )
    .eq("venue_member.member.user_id", waiterId)
    .neq("status", "declined")
    // Da ieri: il turno che il professionista sta lavorando adesso non deve
    // sparire dai suoi "prossimi" appena scocca mezzanotte.
    .gte("shift.date", addDaysToDate(todayString(), -1));
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(({ venue_member, clock, ...row }) => ({
    ...row,
    clock_method: venue_member.clock_method,
    clock: activeClock(clock as ClockRecordWithCorrections[]),
  })) as AssignmentWithShift[];
  return rows
    .filter(
      (r) =>
        r.shift != null &&
        (!isShiftOver(r.shift) ||
          (r.clock != null && effectiveClockTimes(r.clock).outAt == null))
    )
    .sort((a, b) => shiftSortKey(a.shift!).localeCompare(shiftSortKey(b.shift!)));
}

// Lo storico passato del professionista non si legge più da qui: è paginato da
// `getMyWorkHistoryPage` (RPC `get_my_work_history`). Questa versione scaricava
// tutta la storia in un colpo.

/** La propria assegnazione a un turno, col ruolo per cui si è chiamati. */
export type MyAssignment = Assignment & {
  role: { id: string; name: string } | null;
  clock_method: Enums<"clock_method"> | null;
  clock: ClockRecordWithCorrections | null;
};

/** Waiter side: the waiter's assignment for a specific shift, if any. */
export async function getMyAssignmentForShift(
  shiftId: string,
  waiterId: string
): Promise<MyAssignment | null> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      `*, role:venue_roles(id, name), ${CLOCK_EMBED}, venue_member:venue_members!inner(clock_method, member:workspace_members!inner(user_id))`
    )
    .eq("shift_id", shiftId)
    .eq("venue_member.member.user_id", waiterId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { venue_member, clock, ...row } = data;
  return {
    ...row,
    clock_method: venue_member.clock_method,
    clock: activeClock(clock as ClockRecordWithCorrections[]),
  } as MyAssignment;
}

/**
 * Chi lavora in questo momento o più tardi oggi, sui turni interni della sede.
 *
 * La finestra comprende **ieri** perché chi è in sala all'una di notte sta
 * lavorando un turno datato ieri: è il caso in cui il ristoratore ha più bisogno
 * di sapere chi ha in servizio, ed era esattamente quello che spariva.
 */
export async function getOwnerTodayAssignments(
  venueIds: string[]
): Promise<TodayAssignmentRow[]> {
  if (venueIds.length === 0) return [];
  const today = todayString();
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      `*, role:venue_roles(id, name), ${CLOCK_EMBED}, ${VENUE_MEMBER_WITH_RATING}, shift:shifts!inner(id, title, date, start_time, end_time, venue_id, status)`
    )
    // `venue_id` resta nel select del sub-embed: serve al badge della sede.
    .in("shift.venue_id", venueIds)
    .gte("shift.date", addDaysToDate(today, -1))
    .lte("shift.date", today)
    // I turni annullati non contano tra chi lavora oggi.
    .neq("shift.status", "cancelled")
    .neq("status", "declined");
  if (error) throw new Error(error.message);
  const rows: TodayAssignmentRow[] = (data ?? []).map(
    ({ venue_member, clock, ...row }) => ({
      ...row,
      clock: activeClock(clock as ClockRecordWithCorrections[]),
      staff_member: venue_member ? toStaffMember(venue_member) : null,
    })
  );
  return rows
    // Di ieri resta solo ciò che non è ancora finito; di oggi resta tutto.
    .filter((r) => r.shift != null && !isShiftOver(r.shift))
    .sort((a, b) => shiftSortKey(a.shift!).localeCompare(shiftSortKey(b.shift!)));
}
