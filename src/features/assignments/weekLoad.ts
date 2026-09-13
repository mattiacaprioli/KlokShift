import { shiftDurationHours } from "@/lib/format";
import { isActiveAssignment, type AssignmentStatus } from "./status";

/**
 * Carico di lavoro **programmato** per persona su un intervallo di giorni.
 *
 * ⚠️ Non è il consuntivo: qui le ore vengono dagli orari del turno, mentre le
 * ore *lavorate* stanno in `shift_assignments.worked_hours` e le aggrega
 * `get_owner_hours_summary` (pagina Ore, quella che va al commercialista). Questo
 * serve **mentre** si assegna, per accorgersi degli squilibri prima che
 * diventino un problema di busta paga.
 */

/** Orario ordinario settimanale (D.Lgs. 66/2003, art. 3). */
export const ORDINARY_WEEK_HOURS = 40;
/** Durata massima settimanale, straordinari inclusi (art. 4: media su 4 mesi). */
export const MAX_WEEK_HOURS = 48;

type LoadAssignment = {
  id: string;
  status: AssignmentStatus;
  /** Il ruolo ricoperto su **questo** turno, se è stato scelto. */
  role: { name: string } | null;
  staff_member: {
    id: string;
    display_name: string;
    /** La persona: la chiave con cui si incrociano i turni delle altre sedi. */
    person_id: string;
  } | null;
};

/** Il minimo che serve al calcolo: un turno con i suoi assegnati. */
export type LoadShift = {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  shift_assignments: LoadAssignment[];
};

/** Un turno visto dal lato della persona. */
export type PersonShift = {
  shiftId: string;
  /** La riga di assegnazione: è quella che si sposta se il turno cambia mano. */
  assignmentId: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  status: AssignmentStatus;
  /** In che ruolo ci lavora quel giorno (null se non ancora deciso). */
  role: string | null;
  /** Ore che questo turno aggiunge al carico: 0 se la persona non viene. */
  hours: number;
};

/** Un turno in un'altra sede del titolare: solo quel che serve a sommare le ore. */
export type ElsewhereLoadShift = {
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  venue: { name: string } | null;
  shift_assignments: {
    status: AssignmentStatus;
    staff_member: { person_id: string } | null;
  }[];
};

export type PersonLoad = {
  /**
   * L'appartenenza **nella sede attiva**: è ciò che si assegna e si riassegna.
   * Il drag & drop e il "+" su una cella vuota lavorano con questo, perché un
   * turno si crea in un locale.
   */
  staffMemberId: string;
  /**
   * La **persona**: è il livello a cui si contano le ore e si giudicano le
   * soglie. Una settimana da 55 ore non diventa legale perché è spezzata su due
   * locali.
   */
  personId: string;
  name: string;
  /** Le mansioni della persona, già composte ("Cameriere, Barman"). */
  roles: string | null;
  /** Turni per data (`YYYY-MM-DD`) — solo questa sede: il planning pianifica un locale. */
  byDay: Map<string, PersonShift[]>;
  /** Ore programmate in **questa** sede. */
  hours: number;
  /** Ore programmate in **tutte** le sedi del titolare: è su queste che si giudica. */
  totalHours: number;
  /** Le altre sedi che contribuiscono, per la riga sotto il totale. */
  elsewhere: { venueName: string; hours: number }[];
  /** Giorni distinti con lavoro, **tutte** le sedi: il riposo settimanale è uno. */
  daysWorked: number;
};

/**
 * Pivota i turni dell'intervallo per persona. `roster` fissa le righe, così chi
 * non lavora nel periodo compare comunque **a zero** — che è metà
 * dell'informazione: senza quelle righe non si vede chi è rimasto fermo.
 *
 * `elsewhere` sono i turni della stessa settimana nelle **altre** sedi del
 * titolare. Serve perché le soglie 40h/48h sono della *persona*: prima 30 ore a
 * Roma più 25 a Milano erano due celle verdi in due viste diverse, mentre sono 55
 * ore e uno straordinario. Chi non è nel roster di questa sede viene ignorato: non
 * ha una riga da pianificare qui.
 *
 * Ordinamento per ore **totali** decrescenti: questa vista esiste per far salire in
 * cima i casi estremi, e il caso estremo ora è cross-sede.
 */
export function computeWeekLoad(
  shifts: LoadShift[],
  roster: {
    id: string;
    person_id: string;
    display_name: string;
    roles: string | null;
  }[],
  elsewhere: ElsewhereLoadShift[] = []
): PersonLoad[] {
  const rows = new Map<string, PersonLoad>();
  const activeDays = new Map<string, Set<string>>();
  /** person_id → riga, per incrociare i turni delle altre sedi. */
  const byPerson = new Map<string, PersonLoad>();

  function row(member: {
    id: string;
    person_id: string;
    display_name: string;
    roles?: string | null;
  }): PersonLoad {
    const existing = rows.get(member.id);
    if (existing) return existing;
    const created: PersonLoad = {
      staffMemberId: member.id,
      personId: member.person_id,
      name: member.display_name,
      roles: member.roles ?? null,
      byDay: new Map(),
      hours: 0,
      totalHours: 0,
      elsewhere: [],
      daysWorked: 0,
    };
    rows.set(member.id, created);
    byPerson.set(member.person_id, created);
    activeDays.set(member.id, new Set());
    return created;
  }

  for (const member of roster) row(member);

  for (const shift of shifts) {
    // Un turno annullato non è carico di lavoro per nessuno.
    if (shift.status === "cancelled") continue;
    for (const assignment of shift.shift_assignments) {
      const member = assignment.staff_member;
      if (!member) continue;
      const person = row(member);
      const active = isActiveAssignment(assignment.status);
      const hours = active
        ? shiftDurationHours(shift.start_time, shift.end_time)
        : 0;

      const list = person.byDay.get(shift.date) ?? [];
      list.push({
        shiftId: shift.id,
        assignmentId: assignment.id,
        title: shift.title,
        date: shift.date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        status: assignment.status,
        role: assignment.role?.name ?? null,
        hours,
      });
      person.byDay.set(shift.date, list);
      person.hours += hours;
      person.totalHours += hours;
      if (active) activeDays.get(member.id)?.add(shift.date);
    }
  }

  // Secondo passaggio: le altre sedi. Non entrano in `byDay` — le loro celle non
  // sono pianificabili da qui — ma contano nel totale e nei giorni di riposo.
  for (const shift of elsewhere) {
    if (shift.status === "cancelled") continue;
    for (const assignment of shift.shift_assignments) {
      const personId = assignment.staff_member?.person_id;
      if (!personId) continue;
      const person = byPerson.get(personId);
      if (!person) continue; // non è nel roster di questa sede: niente riga qui
      if (!isActiveAssignment(assignment.status)) continue;

      const hours = shiftDurationHours(shift.start_time, shift.end_time);
      person.totalHours += hours;
      activeDays.get(person.staffMemberId)?.add(shift.date);

      const venueName = shift.venue?.name ?? "Altra sede";
      const bucket = person.elsewhere.find((e) => e.venueName === venueName);
      if (bucket) bucket.hours += hours;
      else person.elsewhere.push({ venueName, hours });
    }
  }

  for (const [id, days] of activeDays) {
    const person = rows.get(id);
    if (person) person.daysWorked = days.size;
  }

  for (const person of rows.values()) {
    person.elsewhere.sort((a, b) =>
      a.venueName.localeCompare(b.venueName, "it")
    );
  }

  return [...rows.values()].sort(
    (a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name, "it")
  );
}
