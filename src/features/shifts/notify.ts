import type { AssignmentStatus } from "@/features/assignments/status";
import { toDateString } from "@/lib/format";

/**
 * Chi riceve una notifica se cambia la data (o l'orario) di un turno. Il conto
 * lo fa `moveImpact.ts`, gemello client di `notify_on_shift_change()`
 * (`supabase/migrations/20260920000800_shifts.sql`): gli assegnati attivi **con
 * account collegato**, tolto chi modifica. Se il trigger cambia destinatari,
 * va cambiato con lui, o l'interfaccia prometterà avvisi che nessuno riceve.
 */
export type ShiftNotifyRecipients = {
  /** Nomi di chi è assegnato e verrà avvisato, per poterli nominare. */
  assignees: string[];
  total: number;
};

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
 * Gemello client di due trigger, entrambi in `20260920000800_shifts.sql`:
 * `notify_on_assignment_removed` per chi esce — che si ferma su rifiuto,
 * account mancante, turno annullato e turni già passati — e
 * `notify_on_assignment` per chi entra, che chiede solo un account collegato
 * (e non salta i turni passati: chi entra viene avvisato comunque).
 *
 * Vale anche quando la persona è la stessa su entrambi i lati: è il caso di
 * `move_assignment`, dove esce da un turno ed entra in un altro.
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
