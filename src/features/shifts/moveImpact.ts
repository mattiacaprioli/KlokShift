import { absenceForShift, type AbsenceWindow } from "@/features/absences/conflicts";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import {
  addDaysToDate,
  formatDate,
  formatShiftRange,
  shiftEndsAt,
  type ShiftTimes,
} from "@/lib/format";
import {
  reassignNotifyPlan,
  type ReassignNotifyPlan,
  type ShiftNotifyRecipients,
} from "./notify";
import type { ShiftWithAssignees } from "./types";

/**
 * Cosa succede davvero quando un turno cambia giorno, o quando una persona
 * passa da un turno a un altro.
 *
 * Nasce il 20/09/2026 da una divergenza: le stesse conseguenze — notifiche
 * sul telefono di qualcuno, conferme da rifare — venivano raccontate solo da
 * chi trascinava nel planning, mentre il pannello della dashboard e il form
 * dell'app facevano la stessa scrittura in silenzio. Il calcolo sta qui, in
 * `src/`, perché lo devono vedere tutti e tre: la regola è una sola, e se
 * cambia deve cambiare in un posto solo.
 *
 * ⚠️ Come `notify.ts`, di cui è il seguito, questo file è un **gemello
 * manuale** dei trigger SQL (`notify_on_shift_change`, `notify_on_assignment`,
 * `notify_on_assignment_removed`). Se cambiano loro, va cambiato lui, o
 * l'interfaccia prometterà conseguenze che non arrivano.
 */

/** Il minimo per riconoscere una persona in un avviso. */
type Named = { name: string };

export type MoveImpact = {
  /** Chi riceve «Turno modificato». */
  notify: ShiftNotifyRecipients;
  /** Chi aveva confermato e dovrà rifarlo: il trigger riapre la conferma. */
  reopens: string[];
  /** Assegnati che nel giorno d'arrivo non ci sono. Avviso, mai blocco. */
  absent: (Named & { status: AbsenceWindow["status"] })[];
  /** Assegnati che finirebbero su due turni sovrapposti. Avviso, mai blocco. */
  overlaps: (Named & { title: string; range: string })[];
};

export const NO_IMPACT: MoveImpact = {
  notify: { assignees: [], total: 0 },
  reopens: [],
  absent: [],
  overlaps: [],
};

/**
 * Dati minimi da caricare attorno al giorno d'arrivo. Il giorno precedente
 * contiene i turni notturni ancora in corso; quello successivo contiene sia
 * le assenze toccate dopo mezzanotte sia i turni che iniziano prima della fine
 * di un turno notturno.
 */
export function moveImpactWindow(date: string): { from: string; to: string } {
  return {
    from: addDaysToDate(date, -1),
    to: addDaysToDate(date, 1),
  };
}

/** Limita un range più largo (per esempio il mese visibile) al bersaglio. */
export function moveImpactCandidates<T extends { date: string }>(
  shifts: T[],
  date: string
): T[] {
  const { from, to } = moveImpactWindow(date);
  return shifts.filter((shift) => shift.date >= from && shift.date <= to);
}

export const MOVE_IMPACT_LOADING =
  "Attendi: stiamo verificando assenze e sovrapposizioni.";
export const MOVE_IMPACT_UNAVAILABLE =
  "Non riusciamo a verificare assenze e sovrapposizioni. Riprova.";

/**
 * Un'assenza già collocata sulla persona. `AbsenceAvailability` la soddisfa
 * (`member_id` è la persona, e il tipo non c'è: lo nasconde la RPC, GDPR).
 */
type PersonAbsence = AbsenceWindow & { member_id: string };

/**
 * Il minimo che serve per sapere chi tocca uno spostamento. Volutamente **non**
 * `ShiftWithAssignees`: il pannello della dashboard e il form dell'app leggono
 * gli assegnati da `getShiftAssignments`, che ha un'altra forma, e chiedere
 * loro di costruire un finto turno completo è il modo in cui si finisce a
 * scrivere un cast.
 */
export type MoveAssignee = {
  status: AssignmentStatus;
  /** `staff_people.id` / `venue_members.member_id`: la persona. */
  personId: string;
  displayName: string;
  /** Senza account collegato non c'è nessuno da notificare. */
  waiterId: string | null;
};

/** Gli assegnati di un turno già in forma `ShiftWithAssignees`. */
export function assigneesOf(shift: ShiftWithAssignees): MoveAssignee[] {
  return shift.shift_assignments.flatMap((a) =>
    a.staff_member
      ? [
          {
            status: a.status,
            personId: a.staff_member.person_id,
            displayName: a.staff_member.display_name,
            waiterId: a.staff_member.waiter_id,
          },
        ]
      : []
  );
}

export function shiftMoveImpact(input: {
  /** L'id del turno che si sposta: serve a non contarlo fra le sovrapposizioni. */
  shiftId: string;
  /** Un turno annullato non fa partire niente: il trigger si ferma prima. */
  cancelled?: boolean;
  assignees: MoveAssignee[];
  /** Dove finisce: data e orari nuovi (gli orari possono non cambiare). */
  to: ShiftTimes;
  /** Chi sta spostando, se è anche in organico: il trigger lo salta. */
  myWaiterId?: string;
  /** Le assenze della finestra adiacente, di chiunque: filtrate per persona. */
  absences: PersonAbsence[];
  /**
   * I turni della finestra adiacente, di tutte le sedi gestite. Il confronto
   * sugli istanti decide poi quali si sovrappongono davvero.
   */
  dayShifts?: ShiftWithAssignees[];
  now?: Date;
}): MoveImpact {
  const {
    shiftId,
    cancelled,
    assignees,
    to,
    myWaiterId,
    absences,
    dayShifts = [],
    now = new Date(),
  } = input;
  if (cancelled) return NO_IMPACT;

  // Gli stessi destinatari di `notify_on_shift_change`: assegnati attivi, con
  // un account collegato, tolto chi sta facendo la modifica.
  const active = assignees.filter((a) => isActiveAssignment(a.status));
  const notified = active.filter(
    (a) => a.waiterId && a.waiterId !== myWaiterId
  );
  const notify: ShiftNotifyRecipients = {
    assignees: notified.map((a) => a.displayName),
    total: notified.length,
  };

  // Il trigger riapre le conferme solo se il turno d'arrivo non è già finito,
  // e non tocca chi sta modificando.
  const reopens =
    shiftEndsAt(to.date, to.start_time, to.end_time) > now
      ? active
          .filter((a) => a.status === "confirmed" && a.waiterId !== myWaiterId)
          .map((a) => a.displayName)
      : [];

  const absent: MoveImpact["absent"] = [];
  const overlaps: MoveImpact["overlaps"] = [];
  for (const person of active) {
    const hit = absenceForShift(
      to,
      absences.filter((x) => x.member_id === person.personId)
    );
    if (hit) absent.push({ name: person.displayName, status: hit.status });

    const clash = dayShifts.find(
      (other) =>
        other.id !== shiftId &&
        other.status !== "cancelled" &&
        other.shift_assignments.some(
          (x) =>
            isActiveAssignment(x.status) &&
            x.staff_member?.person_id === person.personId
        ) &&
        shiftsOverlap(to, other)
    );
    if (clash) {
      overlaps.push({
        name: person.displayName,
        title: clash.title,
        range: formatShiftRange(clash.start_time, clash.end_time),
      });
    }
  }

  return { notify, reopens, absent, overlaps };
}

/**
 * Due turni si accavallano? Si confrontano gli istanti e non gli orari: un
 * turno che comincia alle 22:00 e finisce alle 04:00 sconfina nel giorno dopo
 * (`shiftEndsAt`), e con i soli `time` sembrerebbe finire prima di cominciare.
 */
function shiftsOverlap(a: ShiftTimes, b: ShiftTimes): boolean {
  const aStart = new Date(`${a.date}T${a.start_time.slice(0, 5)}:00`);
  const bStart = new Date(`${b.date}T${b.start_time.slice(0, 5)}:00`);
  return (
    aStart < shiftEndsAt(b.date, b.start_time, b.end_time) &&
    bStart < shiftEndsAt(a.date, a.start_time, a.end_time)
  );
}

export function hasMoveImpact(i: MoveImpact): boolean {
  return (
    i.notify.total > 0 ||
    i.reopens.length > 0 ||
    i.absent.length > 0 ||
    i.overlaps.length > 0
  );
}

/** "Anna", "Anna e Bruno", "Anna, Bruno e Carla". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** I nomi solo quando sono pochi: oltre, un elenco non aiuta a decidere. */
function fewNames(names: string[]): string {
  return names.length > 0 && names.length <= 4 ? `: ${nameList(names)}` : "";
}

/**
 * Le conseguenze in italiano, una frase per riga e nell'ordine in cui contano:
 * prima chi lo saprà, poi cosa dovrà rifare, poi i due avvisi.
 */
export function moveImpactLines(i: MoveImpact): string[] {
  const lines: string[] = [];
  if (i.notify.total > 0) {
    lines.push(
      i.notify.total === 1
        ? `Una persona riceverà la notifica del cambio${fewNames(i.notify.assignees)}.`
        : `${i.notify.total} persone riceveranno la notifica del cambio${fewNames(i.notify.assignees)}.`
    );
  }
  if (i.reopens.length > 0) {
    lines.push(
      i.reopens.length === 1
        ? `${i.reopens[0]} aveva confermato: dovrà confermare di nuovo.`
        : `${nameList(i.reopens)} avevano confermato: dovranno confermare di nuovo.`
    );
  }
  for (const a of i.absent) {
    lines.push(
      a.status === "approved"
        ? `${a.name} quel giorno non c'è.`
        : `${a.name} ha chiesto di non esserci quel giorno.`
    );
  }
  for (const o of i.overlaps) {
    lines.push(`${o.name} quel giorno ha già «${o.title}» ${o.range}.`);
  }
  return lines;
}

/**
 * La riga d'apertura: cosa si sta spostando e dove. Se il giorno non cambia —
 * si è corretto solo l'orario — lo dice, invece di annunciare un passaggio da
 * una data a sé stessa.
 */
export function moveHeadline(
  title: string,
  from: ShiftTimes,
  to: ShiftTimes
): string {
  if (from.date === to.date) {
    return `«${title}» del ${formatDate(from.date)} passa a ${formatShiftRange(to.start_time, to.end_time)}.`;
  }
  return `«${title}» passa da ${formatDate(from.date)} a ${formatDate(to.date)}.`;
}

// ---------------------------------------------------------------------------
// Spostare una PERSONA da un turno a un altro
// ---------------------------------------------------------------------------

export type MoveAssignmentImpact = {
  /** Chi si sposta riceve «Turno revocato» e «Nuovo turno assegnato». */
  plan: ReassignNotifyPlan;
  /** È assente nel giorno d'arrivo. */
  absence: AbsenceWindow | null;
  /** Il turno di partenza resta senza nessuno. */
  leavesEmpty: boolean;
  /** Il turno d'arrivo ha già tutti i posti coperti. */
  targetFull: boolean;
};

export function moveAssignmentImpact(input: {
  from: ShiftWithAssignees;
  /** L'assegnazione che si sposta. */
  assignmentId: string;
  /** Dove finisce: un turno che esiste, o il gemello ancora da creare. */
  to: { shift: ShiftWithAssignees } | { date: string };
  /** Le assenze della sola persona che si sposta. */
  absences: AbsenceWindow[];
}): MoveAssignmentImpact {
  const { from, assignmentId, to, absences } = input;
  const row = from.shift_assignments.find((a) => a.id === assignmentId);
  const waiterId = row?.staff_member?.waiter_id ?? null;
  const target = "shift" in to ? to.shift : null;
  const toDate = "shift" in to ? to.shift.date : to.date;

  // Chi si sposta è la stessa persona su entrambi i lati: la revoca e
  // l'assegnazione hanno lo stesso destinatario.
  const plan = reassignNotifyPlan({
    shiftDate: from.date,
    shiftCancelled: from.status === "cancelled",
    from: { status: row?.status ?? "assigned", waiterId },
    toWaiterId: waiterId,
  });

  const times: ShiftTimes = target
    ? { date: target.date, start_time: target.start_time, end_time: target.end_time }
    : { date: toDate, start_time: from.start_time, end_time: from.end_time };

  return {
    plan,
    absence: absenceForShift(times, absences),
    leavesEmpty:
      from.shift_assignments.filter(
        (a) => a.id !== assignmentId && isActiveAssignment(a.status)
      ).length === 0,
    targetFull: target
      ? target.shift_assignments.filter((a) => isActiveAssignment(a.status))
          .length >= target.positions_total
      : false,
  };
}

export function moveAssignmentLines(
  i: MoveAssignmentImpact,
  who: string,
  fromTitle: string,
  fromDate: string
): string[] {
  const lines: string[] = [];
  if (i.plan.notifiesFrom && i.plan.notifiesTo) {
    lines.push(`${who} riceverà «Turno revocato» e «Nuovo turno assegnato».`);
  } else if (i.plan.notifiesTo) {
    lines.push(`${who} riceverà «Nuovo turno assegnato».`);
  } else if (!i.plan.notifiesFrom && !i.plan.notifiesTo) {
    lines.push(`${who} non ha un account collegato: non riceverà nulla.`);
  }
  if (i.absence) {
    lines.push(
      i.absence.status === "approved"
        ? `${who} quel giorno non c'è.`
        : `${who} ha chiesto di non esserci quel giorno.`
    );
  }
  if (i.targetFull) {
    lines.push("Il turno d'arrivo ha già tutti i posti coperti.");
  }
  if (i.leavesEmpty) {
    lines.push(`«${fromTitle}» del ${formatDate(fromDate)} resta senza nessuno.`);
  }
  return lines;
}
