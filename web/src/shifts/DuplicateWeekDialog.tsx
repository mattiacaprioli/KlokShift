import { useMemo, useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useCopyInternalShifts } from "@/features/assignments/hooks";
import { useOwnerShiftsRange } from "@/features/shifts/hooks";
import { addDaysToDate, formatDate, formatShiftRange } from "@/lib/format";
import type { Shift } from "@/features/shifts/api";
import { addDays, weekDays, weekLabel } from "../lib/week";
import { Button, Pill } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * Solo i campi che servono a decidere e a mostrare l'anteprima: così il dialogo
 * accetta qualunque arricchimento del turno usi il Planning (conteggi,
 * copertura) senza dipenderne.
 */
type SourceShift = Pick<
  Shift,
  "id" | "title" | "date" | "start_time" | "end_time" | "status"
>;

/**
 * «Copia questa settimana su quella dopo». Un locale fa più o meno la stessa
 * settimana ogni settimana: senza questo, programmare i prossimi sette giorni
 * vuol dire riaprire quattordici volte lo stesso pannello.
 *
 * Si sposta di **settimane intere**, non di giorni: così un turno del venerdì
 * ricade sempre di venerdì, che è l'unico spostamento sensato per un turno di
 * servizio.
 */
export function DuplicateWeekDialog({
  monday,
  shifts,
  onClose,
}: {
  monday: Date;
  shifts: SourceShift[];
  onClose: () => void;
}) {
  const toast = useToast();
  // ⚠️ Ogni copia resta nella sede del turno che l'ha generata: la settimana
  // duplicata può contenere Roma e Milano, e un `venue_id` unico le spingerebbe
  // tutte in una sede sola. Se ne occupa `getInternalShiftPlans`, che porta il
  // `venue_id` **per piano**.
  const copy = useCopyInternalShifts();

  const [weekOffset, setWeekOffset] = useState(1);
  const [withStaff, setWithStaff] = useState(true);

  const dayShift = weekOffset * 7;
  const targetMonday = addDays(monday, dayShift);

  // Copiabili: i turni ancora validi. Un annullato non si duplica — la copia
  // ricreerebbe proprio quello che il gestore aveva tolto.
  const { copyable, skippedCancelled } = useMemo(() => {
    const copyable: SourceShift[] = [];
    let skippedCancelled = 0;
    for (const s of shifts) {
      if (s.status === "cancelled") skippedCancelled++;
      else copyable.push(s);
    }
    return { copyable, skippedCancelled };
  }, [shifts]);

  // Quanti turni ci sono già nella settimana di destinazione: la copia
  // **aggiunge**, non sostituisce, quindi va detto prima e non dopo. Gli
  // annullati non contano: non sono doppioni di cui preoccuparsi.
  const targetDays = weekDays(targetMonday);
  const targetShifts = useOwnerShiftsRange(targetDays[0], targetDays[6]).data;
  const targetExisting = (targetShifts ?? []).filter(
    (s) => s.status !== "cancelled"
  ).length;

  function submit() {
    copy.mutate(
      { sourceIds: copyable.map((s) => s.id), dayShift, withStaff },
      {
        onSuccess: (created) => {
          toast.show(
            `${created.length} ${created.length === 1 ? "turno copiato" : "turni copiati"} su ${weekLabel(targetMonday)}`
          );
          onClose();
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Duplica la settimana"
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-border-2 bg-bg-0 p-6"
      >
        <header className="mb-5">
          <h2 className="font-serif text-xl text-t1">Duplica la settimana</h2>
          <p className="mt-1 text-xs text-t3">
            Da {weekLabel(monday)} — {copyable.length}{" "}
            {copyable.length === 1 ? "turno interno" : "turni interni"}
          </p>
        </header>

        {copyable.length === 0 ? (
          <>
            <p className="rounded-xl border border-dashed border-border-2 px-4 py-6 text-center text-sm text-t3">
              Questa settimana non ha turni interni da copiare.
            </p>
            <div className="mt-5">
              <Button onClick={onClose}>Chiudi</Button>
            </div>
          </>
        ) : (
          <>
            <section className="mb-5">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
                Copia su
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setWeekOffset((w) => Math.max(1, w - 1))}
                  disabled={weekOffset <= 1}
                  aria-label="Settimana precedente"
                >
                  ←
                </Button>
                <span className="flex-1 rounded-xl border border-border-2 bg-bg-1 px-3 py-2 text-center text-sm text-t1">
                  {weekLabel(targetMonday)}
                </span>
                <Button
                  onClick={() => setWeekOffset((w) => w + 1)}
                  aria-label="Settimana successiva"
                >
                  →
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-t4">
                {weekOffset === 1
                  ? "La settimana subito dopo."
                  : `${weekOffset} settimane dopo.`}
              </p>
            </section>

            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border-2 bg-bg-1 p-3">
              <input
                type="checkbox"
                checked={withStaff}
                onChange={(e) => setWithStaff(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-gold"
              />
              <span>
                <span className="block text-sm text-t1">
                  Copia anche le persone assegnate
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-t4">
                  {withStaff
                    ? "Ognuno riceverà la notifica del nuovo turno. Chi aveva rifiutato o era assente non viene ricopiato."
                    : "Copia solo orari e fabbisogno per ruolo: i turni restano da assegnare e nessuno riceve notifiche."}
                </span>
              </span>
            </label>

            {targetExisting > 0 ? (
              <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                La settimana di destinazione ha già {targetExisting}{" "}
                {targetExisting === 1 ? "turno" : "turni"}: questi{" "}
                <b>si aggiungono</b>, non li sostituiscono.
              </p>
            ) : null}

            <section className="mb-5">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
                Cosa verrà creato
              </span>
              <div className="flex flex-col gap-1">
                {copyable.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border-2 bg-bg-1 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-t1">
                      {s.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-t3">
                      {formatShiftRange(s.start_time, s.end_time)}
                    </span>
                    <span className="w-28 shrink-0 text-right text-xs text-t2">
                      {formatDate(addDaysToDate(s.date, dayShift))}
                    </span>
                  </div>
                ))}
              </div>

              {skippedCancelled > 0 ? (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-t4">
                  Esclusi:
                  <Pill tone="neutral">{skippedCancelled} annullati</Pill>
                </p>
              ) : null}
            </section>

            {copy.isError ? (
              <p className="mb-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                {userErrorMessage(copy.error)}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="gold" onClick={submit} disabled={copy.isPending}>
                {copy.isPending
                  ? "Copia in corso…"
                  : `Crea ${copyable.length} ${copyable.length === 1 ? "turno" : "turni"}`}
              </Button>
              <Button onClick={onClose} disabled={copy.isPending}>
                Annulla
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
