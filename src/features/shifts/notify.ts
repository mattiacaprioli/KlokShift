import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import { toDateString } from "@/lib/format";
import type { ShiftWithAssignees } from "./types";

/**
 * Chi riceve una notifica se cambia la data (o l'orario) di un turno.
 *
 * Gemello client di `notify_on_shift_change()`
 * (`supabase/migrations/20260910120300_notify_triggers.sql`): gli assegnati
 * attivi **con account collegato**. Le due condizioni vanno tenute allineate a
 * mano — se il trigger cambia destinatari, questo file va cambiato con lui, o
 * l'interfaccia prometterà avvisi che nessuno riceve.
 *
 * Nota: il trigger fa ancora una `union` con i candidati accettati, ma quel
 * ramo non produce più righe — nessuno scrive più in `applications`.
 *
 * Serve a dire la verità prima di trascinare un turno su un altro giorno: lo
 * spostamento non è mai solo uno spostamento, è una notifica sul telefono di
 * qualcuno.
 */
export type ShiftNotifyRecipients = {
  /** Nomi di chi è assegnato e verrà avvisato, per poterli nominare. */
  assignees: string[];
  total: number;
};

export const NO_RECIPIENTS: ShiftNotifyRecipients = {
  assignees: [],
  total: 0,
};

export function shiftNotifyRecipients(
  shift: ShiftWithAssignees | undefined,
  /**
   * Chi sta spostando il turno, se è anche in organico: da `20260919100200` il
   * trigger salta chi coincide con `auth.uid()` — la notifica direbbe a uno
   * l'orario che ha scritto lui, e la sua conferma non va riaperta. Senza
   * questo la finestra promette un avviso in più di quelli che partono.
   */
  myWaiterId?: string
): ShiftNotifyRecipients {
  if (!shift) return NO_RECIPIENTS;
  // Un turno annullato non genera notifiche: il trigger si ferma prima.
  if (shift.status === "cancelled") return NO_RECIPIENTS;

  const assignees = shift.shift_assignments
    .filter(
      (a) =>
        isActiveAssignment(a.status) &&
        a.staff_member?.waiter_id &&
        a.staff_member.waiter_id !== myWaiterId
    )
    .map((a) => a.staff_member?.display_name ?? "");

  return { assignees, total: assignees.length };
}

/** Perché chi lascia il turno non riceve la revoca. */
export type ReassignSkip = "declined" | "no-account" | "past" | "cancelled";

export type ReassignNotifyPlan = {
  notifiesFrom: boolean;
  /** Null quando la revoca parte davvero. */
  fromSkip: ReassignSkip | null;
  notifiesTo: boolean;
};

/**
 * Chi viene avvisato quando un turno passa di mano.
 *
 * Gemello client di due trigger: `notify_on_assignment_removed`
 * (20260909193312) per chi esce — che si ferma su rifiuto, account mancante,
 * turno annullato e turni già passati — e `notify_on_assignment`
 * (20260712075549) per chi entra, che chiede solo un account collegato (e non
 * salta i turni passati: chi entra viene avvisato comunque).
 */
export function reassignNotifyPlan(input: {
  shiftDate: string;
  shiftCancelled: boolean;
  from: { status: AssignmentStatus; waiterId: string | null };
  toWaiterId: string | null;
}): ReassignNotifyPlan {
  const fromSkip: ReassignSkip | null =
    input.from.status === "declined"
      ? "declined"
      : !input.from.waiterId
        ? "no-account"
        : input.shiftCancelled
          ? "cancelled"
          : input.shiftDate < toDateString(new Date())
            ? "past"
            : null;

  return {
    notifiesFrom: fromSkip === null,
    fromSkip,
    notifiesTo: !!input.toWaiterId,
  };
}
