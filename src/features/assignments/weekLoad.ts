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
  venue_id: string;
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
  /**
   * L'appartenenza su cui questo turno è assegnato, cioè la persona **in quella
   * sede**. Serve al drag & drop: `reassign_shift_assignment` vuole uno
   * `staff_members.id`, e chi riceve il turno deve averne uno **nella sede del
   * turno** — nessun vincolo del database lo impedisce, ma un'assegnazione con
   * `staff_member.venue_id ≠ shift.venue_id` è un dato rotto in silenzio.
   */
  staffMemberId: string;
  /** La sede del turno: decide chi può riceverlo in una riassegnazione. */
  venueId: string;
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

export type PersonLoad = {
  /**
   * La **persona** (`staff_people.id`): è la chiave della riga.
   *
   * Fino al 14/09/2026 le righe erano indicizzate per `staff_members.id`, che è
   * persona × sede: nella vista unificata Marco comparirebbe due volte, e le sue
   * 55 ore sarebbero due celle verdi da 30 e 25. Da allora `elsewhere` e
   * `totalHours` non servono più — non esiste un "altrove" da sommare a mano,
   * perché la query contiene già tutte le sedi.
   */
  personId: string;
  name: string;
  /** Le mansioni della persona, già composte ("Cameriere, Barman"). */
  roles: string | null;
  /** Turni per data (`YYYY-MM-DD`), **tutte** le sedi. */
  byDay: Map<string, PersonShift[]>;
  /** Ore programmate nel periodo: è su queste che si giudicano le soglie. */
  hours: number;
  /** Giorni distinti con lavoro: il riposo settimanale è uno, non uno per sede. */
  daysWorked: number;
};

/**
 * Pivota i turni dell'intervallo **per persona**. `roster` fissa le righe, così
 * chi non lavora nel periodo compare comunque a zero — che è metà
 * dell'informazione: senza quelle righe non si vede chi è rimasto fermo.
 *
 * Le soglie 40h/48h sono della *persona*, non del locale: 30 ore a Roma più 25 a
 * Milano sono 55 ore e uno straordinario. Prima serviva un secondo insieme di
 * turni (`elsewhere`) per dirlo, perché la vista era di una sede sola; ora
 * `shifts` contiene già tutte le sedi del titolare e la somma è naturale.
 *
 * Ordinamento per ore decrescenti: questa vista esiste per far salire in cima i
 * casi estremi.
 */
export function computeWeekLoad(
  shifts: LoadShift[],
  roster: {
    person_id: string;
    display_name: string;
    roles: string | null;
  }[]
): PersonLoad[] {
  const rows = new Map<string, PersonLoad>();
  const activeDays = new Map<string, Set<string>>();

  function row(member: {
    person_id: string;
    display_name: string;
    roles?: string | null;
  }): PersonLoad {
    const existing = rows.get(member.person_id);
    if (existing) return existing;
    const created: PersonLoad = {
      personId: member.person_id,
      name: member.display_name,
      roles: member.roles ?? null,
      byDay: new Map(),
      hours: 0,
      daysWorked: 0,
    };
    rows.set(member.person_id, created);
    activeDays.set(member.person_id, new Set());
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
        // L'appartenenza a cui il turno è agganciato: serve al drag & drop, che
        // deve sapere **in quale sede** quella persona lavora su quel turno.
        staffMemberId: member.id,
        venueId: shift.venue_id,
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
      if (active) activeDays.get(member.person_id)?.add(shift.date);
    }
  }

  for (const [id, days] of activeDays) {
    const person = rows.get(id);
    if (person) person.daysWorked = days.size;
  }

  return [...rows.values()].sort(
    (a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "it")
  );
}
