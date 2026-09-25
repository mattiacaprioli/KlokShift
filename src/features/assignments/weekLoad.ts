import { shiftDurationHours } from "@/lib/format";
import type { Contract } from "@/features/staff/contract";
import {
  assignmentActual,
  type AssignmentActual,
  type ClockRecordWithCorrections,
} from "@/features/clock/hours";
import { isActiveAssignment, type AssignmentStatus } from "./status";

/**
 * Carico di lavoro **programmato** per persona su un intervallo di giorni, con
 * il confronto separato del consuntivo per i soli turni che lo possiedono.
 *
 * ⚠️ Il totale principale non diventa un consuntivo: viene sempre dagli orari
 * del turno. Le ore *lavorate* definitive stanno in
 * `shift_assignments.worked_hours` e le aggrega `get_owner_hours_summary`
 * (pagina Ore, quella che va al commercialista). Qui vengono affiancate solo
 * agli stessi turni già conclusi, per rendere visibile lo scostamento senza
 * confrontarle con il futuro della settimana.
 *
 * Il metro con cui si giudicano queste ore è il contratto della persona
 * (`features/staff/contract.ts`), che ogni titolare imposta sulla scheda. Fino al
 * 14/09/2026 erano due soglie di legge uguali per tutti, 40h e 48h: un numero
 * solo non dice niente su un part-time, e le soglie normative non sono
 * responsabilità del prodotto.
 */

type LoadAssignment = {
  id: string;
  status: AssignmentStatus;
  /** Ore definitive, da approvazione della timbratura o inserimento manuale. */
  worked_hours: number | null;
  attendance_reviewed_at: string | null;
  /** Sola timbratura attiva; gli annullamenti sono già esclusi dal data layer. */
  clock: ClockRecordWithCorrections | null;
  /** Il ruolo ricoperto su **questo** turno, se è stato scelto. */
  role: { name: string } | null;
  staff_member: {
    id: string;
    display_name: string;
    /** La persona: la chiave con cui si incrociano i turni delle altre sedi. */
    person_id: string;
  } | null;
};

/**
 * Un turno su una linea temporale in minuti di calendario. Usiamo UTC solo per
 * numerare i giorni, non per convertire l'orario: le ore programmate sono ore
 * di parete e non devono diventare 3 o 5 durante il cambio dell'ora legale.
 */
function shiftIntervalMinutes(shift: PersonShift): {
  start: number;
  end: number;
} {
  const [year, month, day] = shift.date.split("-").map(Number);
  const dayStart = Date.UTC(year, month - 1, day) / 60_000;
  const [startHour, startMinute] = shift.start_time.split(":").map(Number);
  const [endHour, endMinute] = shift.end_time.split(":").map(Number);
  const start = dayStart + startHour * 60 + startMinute;
  let end = dayStart + endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

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
   * sede**. Serve al drag & drop: la RPC `reassign` vuole un `venue_members.id`,
   * e chi riceve il turno deve averne uno **nella sede del turno** — nessun
   * vincolo del database lo impedisce, ma un'assegnazione con
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
  /**
   * Consuntivo confrontabile con questo turno. `approved` è definitivo;
   * `proposed` viene dalla timbratura completa ma aspetta ancora la revisione.
   */
  actual: AssignmentActual;
  /** Questo turno si sovrappone a un altro turno attivo della stessa persona. */
  overlaps: boolean;
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
  /**
   * Le ore che questa persona deve fare, se il titolare le ha registrate. È il
   * metro della riga: senza, le ore si mostrano e basta.
   */
  contract: Contract | null;
  /** Turni per data (`YYYY-MM-DD`), **tutte** le sedi. */
  byDay: Map<string, PersonShift[]>;
  /** Ore programmate nel periodo: è su queste che si giudica il contratto. */
  hours: number;
  /** Ore duplicate eliminate unendo gli intervalli sovrapposti. */
  overlapHours: number;
  /**
   * Giorni distinti con lavoro. Sono uno per persona, non uno per sede — e
   * servono anche al target dei contratti giornalieri, che senza il numero di
   * giorni non sanno convertirsi a settimana.
   */
  daysWorked: number;
  /** Consuntivo soltanto dei turni che hanno già un dato effettivo definitivo. */
  approvedHours: number;
  approvedPlannedHours: number;
  approvedCount: number;
  /** Timbrature complete che aspettano la revisione del gestore. */
  proposedHours: number;
  proposedPlannedHours: number;
  proposedCount: number;
  /** Timbrature ancora aperte oltre la fine prevista del turno. */
  missingOutCount: number;
};

/**
 * Pivota i turni dell'intervallo **per persona**. `roster` fissa le righe, così
 * chi non lavora nel periodo compare comunque a zero — che è metà
 * dell'informazione: senza quelle righe non si vede chi è rimasto fermo.
 *
 * Il contratto è della *persona*, non della sede: 30 ore a Roma più 25 a Milano
 * sono 55 ore su un contratto solo. Prima serviva un secondo insieme di turni
 * (`elsewhere`) per dirlo, perché la vista era di una sede sola; ora `shifts`
 * contiene già tutte le sedi del titolare e la somma è naturale.
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
    contract: Contract | null;
  }[],
  options: {
    /**
     * Le sedi per cui chi guarda possiede il permesso Ore. Il confronto non
     * deve trasformare la query del Planning in una scorciatoia per leggere
     * presenze fuori dal proprio ambito.
     */
    actualVenueIds: ReadonlySet<string>;
    now?: Date;
  }
): PersonLoad[] {
  const rows = new Map<string, PersonLoad>();
  const activeDays = new Map<string, Set<string>>();
  const activeShifts = new Map<string, PersonShift[]>();

  function row(member: {
    person_id: string;
    display_name: string;
    roles?: string | null;
    contract?: Contract | null;
  }): PersonLoad {
    const existing = rows.get(member.person_id);
    if (existing) return existing;
    const created: PersonLoad = {
      personId: member.person_id,
      name: member.display_name,
      roles: member.roles ?? null,
      // Le righe nate da un'assegnazione (persona fuori dal roster passato) non
      // portano il contratto: la loro cella resta neutra, che è meglio di un
      // confronto con un target che non si è potuto leggere.
      contract: member.contract ?? null,
      byDay: new Map(),
      hours: 0,
      overlapHours: 0,
      daysWorked: 0,
      approvedHours: 0,
      approvedPlannedHours: 0,
      approvedCount: 0,
      proposedHours: 0,
      proposedPlannedHours: 0,
      proposedCount: 0,
      missingOutCount: 0,
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
      const actual: PersonShift["actual"] =
        active && options.actualVenueIds.has(shift.venue_id)
          ? assignmentActual(shift, assignment, options.now)
          : null;

      const list = person.byDay.get(shift.date) ?? [];
      const personShift: PersonShift = {
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
        actual,
        overlaps: false,
      };
      list.push(personShift);
      person.byDay.set(shift.date, list);
      if (active) {
        activeDays.get(member.person_id)?.add(shift.date);
        const activeForPerson = activeShifts.get(member.person_id) ?? [];
        activeForPerson.push(personShift);
        activeShifts.set(member.person_id, activeForPerson);

        if (actual?.kind === "approved") {
          person.approvedHours += actual.hours;
          person.approvedPlannedHours += hours;
          person.approvedCount += 1;
        } else if (actual?.kind === "proposed") {
          person.proposedHours += actual.hours;
          person.proposedPlannedHours += hours;
          person.proposedCount += 1;
        } else if (actual?.kind === "missing_out") {
          person.missingOutCount += 1;
        }
      }
    }
  }

  for (const [id, days] of activeDays) {
    const person = rows.get(id);
    if (!person) continue;
    person.daysWorked = days.size;

    const shifts = activeShifts.get(id) ?? [];
    const intervals = shifts
      .map((shift) => ({ shift, ...shiftIntervalMinutes(shift) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // L'avviso appartiene ai singoli turni: una sovrapposizione è legittima,
    // ma deve essere visibile. Due turni consecutivi (fine = inizio) non si
    // sovrappongono.
    for (let i = 0; i < intervals.length; i += 1) {
      for (let j = i + 1; j < intervals.length; j += 1) {
        if (intervals[j].start >= intervals[i].end) break;
        intervals[i].shift.overlaps = true;
        intervals[j].shift.overlaps = true;
      }
    }

    // Le ore sono tempo della persona, non posti coperti: 14–22 più 18–23
    // valgono 14–23, cioè 9 ore. I due turni restano distinti per responsabilità
    // e copertura, ma il tratto comune entra nel carico una volta sola.
    let unionMinutes = 0;
    let mergedStart: number | null = null;
    let mergedEnd: number | null = null;
    for (const interval of intervals) {
      if (mergedStart == null || mergedEnd == null) {
        mergedStart = interval.start;
        mergedEnd = interval.end;
      } else if (interval.start <= mergedEnd) {
        mergedEnd = Math.max(mergedEnd, interval.end);
      } else {
        unionMinutes += mergedEnd - mergedStart;
        mergedStart = interval.start;
        mergedEnd = interval.end;
      }
    }
    if (mergedStart != null && mergedEnd != null) {
      unionMinutes += mergedEnd - mergedStart;
    }

    person.hours = unionMinutes / 60;
    person.overlapHours = Math.max(
      0,
      shifts.reduce((sum, shift) => sum + shift.hours, 0) - person.hours
    );
  }

  return [...rows.values()].sort(
    (a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "it")
  );
}
