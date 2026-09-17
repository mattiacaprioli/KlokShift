import {
  useSetAssignmentPresence,
  useShiftAssignments,
} from "@/features/assignments/hooks";
import { assignmentHours } from "@/features/assignments/hours";
import { useSelfStaff } from "@/features/staff/self";
import { userErrorMessage } from "@/lib/errors";
import { shiftDurationHours } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Input, Spinner } from "../ui/primitives";

/**
 * Presenze e ore effettive di un turno concluso.
 *
 * Sta qui e non nella pagina Ore perché è qui che i dati vivono già
 * (`useShiftAssignments`): la pagina Ore aggrega per persona sul mese e non
 * conosce le singole assegnazioni. Su desktop l'ora è un campo numerico —
 * molto più veloce degli step ±0,5h dell'app.
 */
export function PresenceSection({
  shiftId,
  venueId,
  startTime,
  endTime,
}: {
  shiftId: string;
  /** La sede del turno: decide se le proprie ore sono proprie da scrivere. */
  venueId: string;
  startTime: string;
  endTime: string;
}) {
  const { data, isPending } = useShiftAssignments(shiftId);
  const presence = useSetAssignmentPresence(shiftId);
  const planned = shiftDurationHours(startTime, endTime);
  /**
   * La propria riga, per chi gestisce e lavora.
   *
   * ⚠️ Sulla riga di un **collaboratore** i controlli non vanno mostrati:
   * `freeze_assignment_payroll` congela status e `worked_hours` in silenzio, e
   * `setAssignmentPresence` fa un update senza `.select()` — il toggle
   * cambierebbe colore, la richiesta tornerebbe 200 e non salverebbe niente.
   * Il titolare invece scrive: le proprie ore non le segna nessun altro.
   */
  const self = useSelfStaff();
  const locked = !self.canEditOwnPayroll(venueId);

  // Chi ha rifiutato il turno non è una presenza da consuntivare: resta in
  // "Chi lavora" con la sua etichetta, ma qui darebbe un "Presente" verde (e un
  // tocco sul toggle ne sovrascriverebbe lo stato con `no_show`).
  const rows = (data ?? []).filter((a) => a.status !== "declined");

  if (isPending) return <Spinner label="Caricamento presenze…" />;
  if (rows.length === 0) return null;

  return (
    <section>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
        Presenze e ore
      </span>
      <div className="flex flex-col gap-1">
        {rows.map((a) => {
          const absent = a.status === "no_show";
          const hours = assignmentHours(a.status, a.worked_hours, {
            start_time: startTime,
            end_time: endTime,
          });
          // La mia riga, e non sono io a poterla consuntivare.
          const mineLocked = locked && self.isSelf(a.staff_member?.waiter_id);
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-t1">
                {a.staff_member?.display_name ?? "—"}
                {self.isSelf(a.staff_member?.waiter_id) ? (
                  <span className="ml-1.5 text-xs text-gold">(tu)</span>
                ) : null}
              </span>

              {mineLocked ? (
                <>
                  <span
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-semibold",
                      absent
                        ? "border-error/40 bg-error/10 text-error"
                        : "border-success/40 bg-success/10 text-success"
                    )}
                  >
                    {absent ? "Assente" : "Presente"}
                  </span>
                  <span className="w-20 text-center font-mono text-xs text-t3">
                    {absent ? "—" : hours}
                  </span>
                </>
              ) : (
              <>
              <button
                type="button"
                onClick={() =>
                  presence.mutate({
                    id: a.id,
                    status: absent ? "confirmed" : "no_show",
                    // Rientrando da un'assenza si torna alla durata pianificata.
                    worked_hours: absent ? null : a.worked_hours,
                  })
                }
                className={cn(
                  "focus-gold rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                  absent
                    ? "border-error/40 bg-error/10 text-error"
                    : "border-success/40 bg-success/10 text-success"
                )}
              >
                {absent ? "Assente" : "Presente"}
              </button>

              <Input
                type="number"
                step={0.5}
                min={0}
                max={24}
                disabled={absent}
                value={absent ? "" : hours}
                onChange={(e) => {
                  const v = e.target.value;
                  presence.mutate({
                    id: a.id,
                    // Campo svuotato → torna alla durata pianificata (null).
                    worked_hours: v === "" ? null : Number(v),
                  });
                }}
                className="w-20 px-2 py-1 text-center font-mono text-xs disabled:opacity-40"
                aria-label="Ore effettive"
              />
              </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-t4">
        Durata pianificata {planned.toString().replace(".", ",")} h. Lascia il
        campo vuoto per usarla; scrivi un numero solo se le ore sono diverse.
      </p>
      {locked && rows.some((a) => self.isSelf(a.staff_member?.waiter_id)) ? (
        <p className="mt-1 text-[11px] text-t4">
          Le tue presenze e le tue ore le segna chi ha il permesso Ore su questa
          sede.
        </p>
      ) : null}
      {presence.isError ? (
        <p className="mt-2 text-xs text-error">{userErrorMessage(presence.error)}</p>
      ) : null}
    </section>
  );
}
