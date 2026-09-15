import { useMemo, useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import { useCopyInternalShifts } from "@/features/assignments/hooks";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import { useOwnerShiftsRange } from "@/features/shifts/hooks";
import { addDaysToDate, formatDate, formatShiftRange } from "@/lib/format";
import type { Shift } from "@/features/shifts/api";
import {
  addDays,
  addMonths,
  monthDays,
  monthTitle,
  sameWeekdaySlot,
  weekDays,
  weekLabel,
} from "../lib/week";
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
> & {
  /** Se c'è, serve solo a contare quante notifiche partiranno. */
  shift_assignments?: { status: AssignmentStatus }[];
};

/** Cosa si sta duplicando. Cambia il passo, le etichette e la regola delle date. */
export type DuplicatePeriod = "week" | "month";

/** Oltre questa soglia la copia smette di essere un gesto e diventa un impegno. */
const BULK_WARN = 30;
/** Righe di anteprima mostrate: un mese intero ne farebbe centinaia. */
const PREVIEW_ROWS = 24;

/**
 * «Copia questa settimana su quella dopo» — e lo stesso per il mese.
 *
 * Una sede fa più o meno la stessa settimana ogni settimana: senza questo,
 * programmare i prossimi sette giorni vuol dire riaprire quattordici volte lo
 * stesso pannello, e un mese ne vuole sessanta.
 *
 * ⚠️ **Le date non si spostano di un numero fisso di giorni.** Sulla settimana
 * sì (7 giorni per settimana, e il venerdì resta venerdì); sul mese no, perché
 * fra il 1° settembre e il 1° ottobre ci sono 30 giorni e un turno del sabato
 * finirebbe di lunedì. Il mese copia **la posizione**: il 2° martedì resta il 2°
 * martedì (`sameWeekdaySlot`). Il prezzo è che una posizione può non esistere
 * nel mese di destinazione — il 5° venerdì — e quei turni restano fuori: si
 * contano prima e si dicono, non si perdono in silenzio.
 */
export function DuplicatePeriodDialog({
  period,
  anchor,
  shifts,
  venueIds,
  onClose,
}: {
  period: DuplicatePeriod;
  /** Il lunedì della settimana, o il 1° del mese, che si sta duplicando. */
  anchor: Date;
  shifts: SourceShift[];
  /** Le sedi del planning che ha aperto il dialogo (filtro per sede incluso). */
  venueIds: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  // ⚠️ Ogni copia resta nella sede del turno che l'ha generata: il periodo
  // duplicato può contenere Roma e Milano, e un `venue_id` unico le spingerebbe
  // tutte in una sede sola. Se ne occupa `getInternalShiftPlans`, che porta il
  // `venue_id` **per piano**.
  const copy = useCopyInternalShifts();

  const isMonth = period === "month";
  const [offset, setOffset] = useState(1);
  const [withStaff, setWithStaff] = useState(true);

  // L'istante, non l'oggetto: `anchor` può essere una `Date` nuova a ogni render
  // del Planning, e finirebbe per rifare tutti i conti di sotto per niente.
  const anchorTime = anchor.getTime();
  const target = isMonth ? addMonths(anchor, offset) : addDays(anchor, offset * 7);
  const sourceLabel = isMonth ? monthTitle(anchor) : weekLabel(anchor);
  const targetLabel = isMonth ? monthTitle(target) : weekLabel(target);

  /** Data di origine → data di destinazione. Vuota quella che non ha posto. */
  const dateMap = useMemo(() => {
    const targetMonth = addMonths(new Date(anchorTime), offset);
    const map: Record<string, string> = {};
    for (const s of shifts) {
      if (map[s.date]) continue;
      const to = isMonth
        ? sameWeekdaySlot(s.date, targetMonth)
        : addDaysToDate(s.date, offset * 7);
      if (to) map[s.date] = to;
    }
    return map;
  }, [shifts, isMonth, offset, anchorTime]);

  // Copiabili: i turni ancora validi che hanno una data dove andare. Un
  // annullato non si duplica — la copia ricreerebbe proprio quello che il
  // gestore aveva tolto.
  const { copyable, skippedCancelled, skippedNoSlot, notifications } =
    useMemo(() => {
      const copyable: SourceShift[] = [];
      let skippedCancelled = 0;
      let skippedNoSlot = 0;
      let notifications = 0;
      for (const s of shifts) {
        if (s.status === "cancelled") {
          skippedCancelled++;
        } else if (!dateMap[s.date]) {
          skippedNoSlot++;
        } else {
          copyable.push(s);
          notifications += (s.shift_assignments ?? []).filter((a) =>
            isActiveAssignment(a.status)
          ).length;
        }
      }
      copyable.sort((a, b) =>
        dateMap[a.date] === dateMap[b.date]
          ? a.start_time.localeCompare(b.start_time)
          : dateMap[a.date].localeCompare(dateMap[b.date])
      );
      return { copyable, skippedCancelled, skippedNoSlot, notifications };
    }, [shifts, dateMap]);

  // Quanti turni ci sono già nel periodo di destinazione: la copia **aggiunge**,
  // non sostituisce, quindi va detto prima e non dopo. Gli annullati non
  // contano: non sono doppioni di cui preoccuparsi.
  const targetRange = isMonth ? monthDays(target) : weekDays(target);
  const targetShifts = useOwnerShiftsRange(
    targetRange[0],
    targetRange[targetRange.length - 1],
    venueIds
  ).data;
  const targetExisting = (targetShifts ?? []).filter(
    (s) => s.status !== "cancelled"
  ).length;

  const preview = copyable.slice(0, PREVIEW_ROWS);
  const previewHidden = copyable.length - preview.length;

  function submit() {
    copy.mutate(
      { sourceIds: copyable.map((s) => s.id), dateMap, withStaff },
      {
        onSuccess: (created) => {
          toast.show(
            `${created.length} ${created.length === 1 ? "turno copiato" : "turni copiati"} su ${targetLabel}`
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
        aria-label={isMonth ? "Duplica il mese" : "Duplica la settimana"}
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-border-2 bg-bg-0 p-6"
      >
        <header className="mb-5">
          <h2 className="font-serif text-xl text-t1">
            {isMonth ? "Duplica il mese" : "Duplica la settimana"}
          </h2>
          <p className="mt-1 text-xs text-t3">
            Da {sourceLabel} — {copyable.length}{" "}
            {copyable.length === 1 ? "turno interno" : "turni interni"}
          </p>
        </header>

        {copyable.length === 0 ? (
          <>
            <p className="rounded-xl border border-dashed border-border-2 px-4 py-6 text-center text-sm text-t3">
              {isMonth
                ? "Questo mese non ha turni interni da copiare."
                : "Questa settimana non ha turni interni da copiare."}
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
                  onClick={() => setOffset((w) => Math.max(1, w - 1))}
                  disabled={offset <= 1}
                  aria-label={isMonth ? "Mese precedente" : "Settimana precedente"}
                >
                  ←
                </Button>
                <span className="flex-1 rounded-xl border border-border-2 bg-bg-1 px-3 py-2 text-center text-sm capitalize text-t1">
                  {targetLabel}
                </span>
                <Button
                  onClick={() => setOffset((w) => w + 1)}
                  aria-label={isMonth ? "Mese successivo" : "Settimana successiva"}
                >
                  →
                </Button>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-t4">
                {offset === 1
                  ? isMonth
                    ? "Il mese subito dopo."
                    : "La settimana subito dopo."
                  : isMonth
                    ? `${offset} mesi dopo.`
                    : `${offset} settimane dopo.`}
                {isMonth ? (
                  <>
                    {" "}
                    I turni tengono il <b>giorno della settimana</b>, non il
                    giorno del mese: il 2° martedì resta il 2° martedì.
                  </>
                ) : null}
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

            {/* Un mese sono decine di turni e altrettante notifiche sui telefoni
                di altre persone: il numero va davanti agli occhi prima del
                click, non nella cronologia dopo. */}
            {withStaff && notifications >= BULK_WARN ? (
              <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                Partiranno <b>{notifications} notifiche</b> a chi è assegnato.
                Togli la spunta qui sopra per copiare solo la griglia e assegnare
                le persone dopo.
              </p>
            ) : null}

            {skippedNoSlot > 0 ? (
              <p className="mb-4 rounded-xl border border-border-2 bg-bg-1 px-3 py-2 text-xs leading-5 text-t3">
                {skippedNoSlot === 1 ? "1 turno resta" : `${skippedNoSlot} turni restano`}{" "}
                fuori: cade in una posizione che{" "}
                <span className="capitalize">{targetLabel}</span> non ha — un 5°
                venerdì, per esempio. Aggiungilo a mano dal planning.
              </p>
            ) : null}

            {targetExisting > 0 ? (
              <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                {isMonth ? "Il mese" : "La settimana"} di destinazione ha già{" "}
                {targetExisting} {targetExisting === 1 ? "turno" : "turni"}:
                questi <b>si aggiungono</b>, non li sostituiscono.
              </p>
            ) : null}

            <section className="mb-5">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-t3">
                Cosa verrà creato
              </span>
              <div className="flex flex-col gap-1">
                {preview.map((s) => (
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
                      {formatDate(dateMap[s.date])}
                    </span>
                  </div>
                ))}
              </div>

              {previewHidden > 0 ? (
                <p className="mt-2 text-xs text-t4">
                  e altri {previewHidden} turni, fino al{" "}
                  {formatDate(dateMap[copyable[copyable.length - 1].date])}.
                </p>
              ) : null}

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
