import { supabase } from "@/lib/supabase";
import {
  addDaysToDate,
  isShiftOver,
  shiftSortKey,
  todayString,
} from "@/lib/format";
import type { Enums, Tables } from "@/types/database";
import type { Shift, ShiftWithVenue } from "@/features/shifts/types";
import type { StaffMember, StaffRoleRef } from "@/features/staff/api";
import { isActiveAssignment } from "./status";
import type { OwnerHoursRow } from "./hoursSummary";
import { UserFacingError } from "@/lib/errors";

export type Assignment = Tables<"shift_assignments">;

/** Waiter side: an assignment joined with its shift + venue. */
export type AssignmentWithShift = Assignment & {
  shift: ShiftWithVenue | null;
  /** In che ruolo è chiamato: è ciò che vuole sapere prima di confermare. */
  role: { id: string; name: string } | null;
};

type WaiterMini = Pick<Tables<"profiles">, "id" | "full_name" | "avatar_url">;

/** Assignment + the staff member (and their linked waiter, if any). */
export type AssignmentWithStaff = Assignment & {
  /** Il ruolo ricoperto su questo turno, non le mansioni della scheda. */
  role: { id: string; name: string } | null;
  staff_member:
    | (StaffMember & {
        waiter: WaiterMini | null;
        staff_member_roles: { role: StaffRoleRef | null }[];
      })
    | null;
};

/** Today's internal-shift assignment, with staff + rating + shift slot (home). */
export type TodayAssignmentRow = Assignment & {
  /** Il ruolo di quel giorno: è la risposta alla domanda che la card pone. */
  role: { id: string; name: string } | null;
  staff_member:
    | (StaffMember & {
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
 * Quanti posti ha un turno interno. Se c'è un fabbisogno per ruolo è lui a
 * dettare il totale: chiamare qualcuno in più — o lasciare in elenco chi ha
 * rifiutato — non aggiunge posti da coprire. Contarli faceva dire "3/4" alla
 * home su un turno che il pannello dava (giustamente) per completo, perché
 * `positions_filled` lo tiene il trigger DB sui soli assegnati attivi.
 * Senza fabbisogno il totale sono le persone chiamate.
 */
function internalPositionsTotal(targetSum: number, activeStaff: number): number {
  return Math.max(1, targetSum > 0 ? targetSum : activeStaff);
}

/**
 * Una persona su un turno, col ruolo che ricopre **quel giorno**.
 *
 * `role_id` null non è un errore: chi ha più mansioni e non ne ha ancora scelta
 * una resta assegnato ma non copre nessun fabbisogno, cioè esattamente quello
 * che succede nella realtà finché non lo si decide. (Con una sola mansione lo
 * riempie il trigger `default_assignment_role`.)
 */
export type StaffAssignmentInput = {
  staff_member_id: string;
  role_id: string | null;
};

/** Fabbisogno per ruolo così come lo scrivono i form. */
export type RoleTargetInput = { role_id: string; count: number };

/**
 * Create a shift and assign it to the given roster members in one go.
 * Positions are pre-filled by the assignees.
 */
export async function createInternalShift(input: {
  venue_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  description: string | null;
  staff: StaffAssignmentInput[];
  /** Fabbisogno per ruolo (es. 2 Cameriere + 1 Sommelier). */
  roleTargets?: RoleTargetInput[];
  /**
   * Chiede la conferma anche ai dipendenti fissi (default: no).
   *
   * Di norma lo stato iniziale di ogni assegnazione lo decide il database
   * (`default_assignment_confirmation`, 20260915100000) guardando
   * `staff_members.employment_type`: il fisso nasce già `confirmed`, chi è a
   * chiamata deve rispondere. Questo flag è l'eccezione per il singolo turno —
   * straordinario, festivo — e vale per tutti.
   */
  require_confirmation?: boolean;
}): Promise<Shift> {
  const { staff, roleTargets, ...fields } = input;
  const targets = (roleTargets ?? []).filter((t) => t.count > 0);
  const targetSum = targets.reduce((s, t) => s + t.count, 0);
  const { data: shift, error } = await supabase
    .from("shifts")
    .insert({
      ...fields,
      kind: "internal",
      status: "open",
      positions_total: internalPositionsTotal(targetSum, staff.length),
      positions_filled: staff.length,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  if (targets.length > 0) {
    const { error: rErr } = await supabase
      .from("shift_role_requirements")
      .insert(
        targets.map((t) => ({
          shift_id: shift.id,
          role_id: t.role_id,
          count: t.count,
        }))
      );
    if (rErr) throw new Error(rErr.message);
  }

  if (staff.length > 0) {
    const rows = staff.map((s) => ({ shift_id: shift.id, ...s }));
    const { error: aErr } = await supabase
      .from("shift_assignments")
      .insert(rows);
    if (aErr) throw new Error(aErr.message);
  }
  return shift;
}

/**
 * La "ricetta" di un turno interno: campi, fabbisogno per ruolo e chi ci lavora.
 * È quanto serve per **riprodurlo altrove** senza rimetterlo a mano — duplicare
 * una settimana, ripetere lo stesso turno su più giorni.
 */
export type InternalShiftPlan = {
  /**
   * ⚠️ La sede sta **sul piano**, non sulla chiamata.
   *
   * Prima `createInternalShifts` prendeva un `venue_id` solo e lo applicava a
   * tutte le copie: andava bene finché una vista conteneva una sede sola.
   * Con il planning unificato, duplicare una settimana che contiene Roma e
   * Milano spingerebbe tutti i turni in una sede sola — e il compilatore non se
   * ne accorgerebbe mai, perché sono entrambe stringhe.
   *
   * Anche `staff_member_id` e `role_id` sono legati alla sede del turno che ha
   * generato il piano: spostare il piano di sede senza rimapparli produrrebbe
   * assegnazioni che il database accetta e che nessuna schermata sa leggere.
   */
  venue_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  description: string | null;
  /** Vedi `createInternalShift`. Va ricopiato: fa parte della ricetta del turno. */
  require_confirmation: boolean;
  roleTargets: RoleTargetInput[];
  staff: StaffAssignmentInput[];
};

/** Legge i turni indicati e ne ricava i piani riproducibili. */
export async function getInternalShiftPlans(
  shiftIds: string[]
): Promise<InternalShiftPlan[]> {
  if (shiftIds.length === 0) return [];
  const { data, error } = await supabase
    .from("shifts")
    .select(
      "venue_id, title, date, start_time, end_time, description, require_confirmation, shift_role_requirements(role_id, count), shift_assignments(staff_member_id, role_id, status)"
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
      .filter((a) => isActiveAssignment(a.status) && !!a.staff_member_id)
      .map((a) => ({
        staff_member_id: a.staff_member_id,
        role_id: a.role_id,
      })),
  }));
}

/**
 * Crea più turni interni in blocco: **tre statement** (turni, fabbisogni,
 * assegnazioni) invece di tre per turno. Ogni statement è atomico, quindi un
 * errore non lascia turni a metà — al più senza fabbisogno per ruolo, cosa
 * visibile e correggibile dal pannello del turno.
 *
 * I trigger DB fanno il resto, come per il turno singolo: ogni assegnato riceve
 * la sua notifica e `positions_filled` resta sincronizzato.
 */
export async function createInternalShifts(
  plans: InternalShiftPlan[]
): Promise<Shift[]> {
  if (plans.length === 0) return [];

  const { data: created, error } = await supabase
    .from("shifts")
    .insert(
      plans.map((p) => {
        const targetSum = p.roleTargets.reduce(
          (s, t) => s + Math.max(0, t.count),
          0
        );
        return {
          venue_id: p.venue_id,
          title: p.title,
          date: p.date,
          start_time: p.start_time,
          end_time: p.end_time,
          description: p.description,
          require_confirmation: p.require_confirmation,
          kind: "internal" as const,
          status: "open" as const,
          positions_total: internalPositionsTotal(targetSum, p.staff.length),
          positions_filled: p.staff.length,
        };
      })
    )
    .select("*");
  if (error) throw new Error(error.message);

  // `INSERT ... RETURNING` restituisce le righe nell'ordine in cui sono state
  // inserite: l'indice riallinea ogni turno creato al piano che lo ha generato.
  // Non è però una garanzia scritta del protocollo, e sbagliare l'allineamento
  // vorrebbe dire assegnare le persone al turno sbagliato **in silenzio**: si
  // verifica su data e ora e si fallisce forte se non torna.
  const shifts = created ?? [];
  const aligned =
    shifts.length === plans.length &&
    shifts.every(
      (s, i) =>
        s.date === plans[i].date &&
        s.start_time.slice(0, 5) === plans[i].start_time.slice(0, 5)
    );
  if (!aligned) {
    throw new UserFacingError(
      `Turni creati (${shifts.length}), ma non è stato possibile riconoscerne l'ordine: fabbisogni e assegnazioni non sono stati applicati. Aprili dal planning e completali a mano.`
    );
  }

  const reqRows = shifts.flatMap((shift, i) =>
    plans[i].roleTargets
      .filter((t) => t.count > 0)
      .map((t) => ({ shift_id: shift.id, role_id: t.role_id, count: t.count }))
  );
  if (reqRows.length > 0) {
    const { error: rErr } = await supabase
      .from("shift_role_requirements")
      .insert(reqRows);
    if (rErr) throw new Error(rErr.message);
  }

  const assignRows = shifts.flatMap((shift, i) =>
    plans[i].staff.map((s) => ({ shift_id: shift.id, ...s }))
  );
  if (assignRows.length > 0) {
    const { error: aErr } = await supabase
      .from("shift_assignments")
      .insert(assignRows);
    if (aErr) throw new Error(aErr.message);
  }

  return shifts;
}

/**
 * Modifica completa di un turno interno: campi base, fabbisogno per ruolo e
 * staff assegnato (diff: i nuovi ricevono la notifica via trigger, i rimossi
 * vengono eliminati e il trigger risincronizza i coperti).
 */
export async function updateInternalShift(
  shiftId: string,
  input: {
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    description: string | null;
    /** Vedi `createInternalShift`. */
    require_confirmation: boolean;
    roleTargets: RoleTargetInput[];
    staff: StaffAssignmentInput[];
  }
): Promise<void> {
  const { roleTargets, staff, ...fields } = input;
  const targets = roleTargets.filter((t) => t.count > 0);
  const targetSum = targets.reduce((s, t) => s + t.count, 0);

  // 0) Stato attuale delle assegnazioni: serve prima di toccare il turno,
  //    perché i posti non contano chi ha rifiutato (e serve poi per il diff).
  const { data: existing, error: eErr } = await supabase
    .from("shift_assignments")
    .select("id, staff_member_id, role_id, status")
    .eq("shift_id", shiftId);
  if (eErr) throw new Error(eErr.message);
  const current = new Map((existing ?? []).map((a) => [a.staff_member_id, a]));
  // Chi viene aggiunto adesso nasce `assigned`, quindi conta come posto.
  const activeStaff = staff.filter((s) => {
    const row = current.get(s.staff_member_id);
    return !row || isActiveAssignment(row.status);
  }).length;

  // 1) Campi base (il trigger notify_on_shift_updated avvisa gli assegnati
  //    se giorno/orario cambiano).
  const { error: sErr } = await supabase
    .from("shifts")
    .update({
      ...fields,
      positions_total: internalPositionsTotal(targetSum, activeStaff),
    })
    .eq("id", shiftId);
  if (sErr) throw new Error(sErr.message);

  // 2) Fabbisogno per ruolo: replace completo (tabella piccola).
  const { error: dErr } = await supabase
    .from("shift_role_requirements")
    .delete()
    .eq("shift_id", shiftId);
  if (dErr) throw new Error(dErr.message);
  if (targets.length > 0) {
    const { error: rErr } = await supabase
      .from("shift_role_requirements")
      .insert(targets.map((t) => ({ shift_id: shiftId, ...t })));
    if (rErr) throw new Error(rErr.message);
  }

  // 3) Diff assegnazioni (sullo stato letto al punto 0).
  const toAdd = staff.filter((s) => !current.has(s.staff_member_id));
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("shift_assignments")
      .insert(toAdd.map((s) => ({ shift_id: shiftId, ...s })));
    if (error) throw new Error(error.message);
  }

  // 3b) Chi resta ma cambia ruolo. Senza questo passaggio spostare qualcuno da
  //     "Cameriere" a "Barman" non si salverebbe: non entra e non esce, quindi
  //     nessuno dei due rami sopra lo tocca. Un UPDATE va bene — qui non cambia
  //     la persona, quindi non c'è nessuno da avvisare.
  const toRetag = staff.filter((s) => {
    const row = current.get(s.staff_member_id);
    return !!row && row.role_id !== s.role_id;
  });
  for (const s of toRetag) {
    const row = current.get(s.staff_member_id);
    if (!row) continue;
    const { error } = await supabase
      .from("shift_assignments")
      .update({ role_id: s.role_id })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  }

  const keep = new Set(staff.map((s) => s.staff_member_id));
  const toRemove = (existing ?? [])
    .filter((a) => !keep.has(a.staff_member_id))
    .map((a) => a.id);
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("shift_assignments")
      .delete()
      .in("id", toRemove);
    if (error) throw new Error(error.message);
  }
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
    .select(
      "*, role:venue_roles(id, name), staff_member:staff_members(*, waiter:profiles!staff_members_waiter_id_fkey(id, full_name, avatar_url), staff_member_roles(role:venue_roles(id, name, sort_order)))"
    )
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as AssignmentWithStaff[] | null) ?? [];
}

export async function updateAssignmentStatus(
  id: string,
  status: Enums<"assignment_status">
): Promise<void> {
  const { error } = await supabase
    .from("shift_assignments")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Passa un'assegnazione a un'altra persona dello stessa sede.
 *
 * Delete + insert dentro una transazione (RPC `reassign_shift_assignment`,
 * migration 20260911120000), non un update di `staff_member_id`: solo così
 * scattano entrambe le notifiche — «Turno revocato» a chi esce, «Nuovo turno
 * assegnato» a chi entra — e chi entra non eredita lo stato (magari
 * "confermato") né le ore di chi esce. Il perché per esteso sta nella migration.
 *
 * Ritorna l'id della nuova riga. Gli errori arrivano già in italiano dalla RPC
 * (persona di un'altra sede, persona già sul turno).
 */
export async function reassignShiftAssignment(
  assignmentId: string,
  toStaffMemberId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("reassign_shift_assignment", {
    p_assignment: assignmentId,
    p_staff_member: toStaffMemberId,
  });
  // Le tre eccezioni di quella RPC sono frasi scritte per essere lette
  // («Questa persona è già su questo turno»): vanno mostrate così come sono,
  // non sostituite dal messaggio generico.
  if (error) throw new UserFacingError(error.message);
  return data as string;
}

/** Presenza a turno concluso: stato (presente/assente) e/o ore effettive. */
export async function setAssignmentPresence(
  id: string,
  fields: { status?: Enums<"assignment_status">; worked_hours?: number | null }
): Promise<void> {
  const { error } = await supabase
    .from("shift_assignments")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Statistiche di una **persona** dell'organico (sezioni "Ore & presenze" e
 * "Performance"). Sette numeri, calcolati dal database.
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
  personId: string
): Promise<StaffPerformance | null> {
  const { data, error } = await supabase
    .rpc("get_person_performance", { p_person: personId })
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
  personId: string,
  limit = STAFF_RECENT_SHIFTS
): Promise<StaffWorkedShift[]> {
  const { data, error } = await supabase.rpc("get_person_worked_shifts", {
    p_person: personId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Storico lavoro del professionista ("Le mie ore"): i turni svolti, in
 * un'unica lista (comprese, per chi ce l'ha, le vecchie candidature accettate).
 *
 * L'unione la fa il database (`get_my_work_history`). Il client non poteva
 * paginare da solo: l'ordinamento è per `shifts.date`, che sta in una tabella
 * collegata, e PostgREST non sa ordinare le righe padre per una colonna
 * dell'embed — quindi prima si scaricavano **due storie intere** e si fondevano
 * in memoria.
 */
export const WORK_HISTORY_PAGE_SIZE = 20;

export type WorkHistoryRow = {
  key: string;
  venue_name: string | null;
  logo_url: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  kind: string;
};

export async function getMyWorkHistoryPage(
  page: number
): Promise<WorkHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_my_work_history", {
    p_limit: WORK_HISTORY_PAGE_SIZE,
    p_offset: page * WORK_HISTORY_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
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
 * ⚠️ Nessun parametro per il titolare: la RPC è INVOKER e usa `auth.uid()`. Il
 * perimetro è «la MIA azienda» e non è negoziabile dal client.
 */
export async function getOwnerHoursSummary(
  month: string
): Promise<OwnerHoursRow[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase.rpc("get_owner_hours_summary", {
    p_from: start,
    p_to: end,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
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

/** Waiter side: the waiter's upcoming assigned shifts (their "Prossimi turni"). */
export async function getMyAssignedUpcoming(
  waiterId: string
): Promise<AssignmentWithShift[]> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "*, role:venue_roles(id, name), staff_member:staff_members!inner(waiter_id), shift:shifts!inner(*, venue:venues(*))"
    )
    .eq("staff_member.waiter_id", waiterId)
    .neq("status", "declined")
    // Da ieri: il turno che il professionista sta lavorando adesso non deve
    // sparire dai suoi "prossimi" appena scocca mezzanotte.
    .gte("shift.date", addDaysToDate(todayString(), -1));
  if (error) throw new Error(error.message);
  const rows = (data as AssignmentWithShift[] | null) ?? [];
  return rows
    .filter((r) => r.shift != null && !isShiftOver(r.shift))
    .sort((a, b) => shiftSortKey(a.shift!).localeCompare(shiftSortKey(b.shift!)));
}

// Lo storico passato del professionista non si legge più da qui: è paginato da
// `getMyWorkHistoryPage` (RPC `get_my_work_history`). Questa versione scaricava
// tutta la storia in un colpo.

/** La propria assegnazione a un turno, col ruolo per cui si è chiamati. */
export type MyAssignment = Assignment & {
  role: { id: string; name: string } | null;
};

/** Waiter side: the waiter's assignment for a specific shift, if any. */
export async function getMyAssignmentForShift(
  shiftId: string,
  waiterId: string
): Promise<MyAssignment | null> {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("*, role:venue_roles(id, name), staff_member:staff_members!inner(waiter_id)")
    .eq("shift_id", shiftId)
    .eq("staff_member.waiter_id", waiterId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MyAssignment | null) ?? null;
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
      "*, role:venue_roles(id, name), staff_member:staff_members!inner(*, waiter:profiles!staff_members_waiter_id_fkey(id, full_name, avatar_url, waiter_profile:waiter_profiles(rating_avg, rating_count))), shift:shifts!inner(id, title, date, start_time, end_time, venue_id, status)"
    )
    // `venue_id` resta nel select del sub-embed: serve al badge della sede.
    .in("shift.venue_id", venueIds)
    .gte("shift.date", addDaysToDate(today, -1))
    .lte("shift.date", today)
    // I turni annullati non contano tra chi lavora oggi.
    .neq("shift.status", "cancelled")
    .neq("status", "declined");
  if (error) throw new Error(error.message);
  const rows = (data as TodayAssignmentRow[] | null) ?? [];
  return rows
    // Di ieri resta solo ciò che non è ancora finito; di oggi resta tutto.
    .filter((r) => r.shift != null && !isShiftOver(r.shift))
    .sort((a, b) => shiftSortKey(a.shift!).localeCompare(shiftSortKey(b.shift!)));
}
