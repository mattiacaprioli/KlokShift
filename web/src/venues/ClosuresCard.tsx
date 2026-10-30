import { useState } from "react";
import type { Venue } from "@/features/venues/api";
import { closureRangeText, upcomingClosures, WEEKDAYS } from "@/features/venues/closures";
import {
  useDeleteVenueClosure,
  useSaveVenueClosure,
  useSetVenueRestDays,
  useVenueCalendar,
} from "@/features/venues/hooks";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { todayString } from "@/lib/format";
import { Button, Card, Field, Input } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * I giorni di chiusura della sede, come nell'app (`VenueClosuresCard`): li
 * vede chi apre la sede, li aggiunge chi ha «Turni» o «Dati della sede». Il
 * team li vede nei Turni; un turno in quei giorni si crea con un avviso.
 */
export function ClosuresCard({ venue, canEdit }: { venue: Venue; canEdit: boolean }) {
  const toast = useToast();
  const { calendar } = useVenueCalendar([venue.id]);
  const save = useSaveVenueClosure();
  const remove = useDeleteVenueClosure();
  const setRest = useSetVenueRestDays();
  const today = todayString();
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [yearly, setYearly] = useState(false);
  const upcoming = upcomingClosures(calendar.closures, venue.id, today);
  const rest = calendar.restDays[venue.id] ?? [];

  function toggleRest(iso: number) {
    const next = rest.includes(iso) ? rest.filter((d) => d !== iso) : [...rest, iso];
    setRest.mutate(
      { venueId: venue.id, days: next },
      { onError: (e) => toast.show(userErrorMessage(e), "error") }
    );
  }

  function onSave() {
    save.mutate(
      { venueId: venue.id, start, end: end < start ? start : end, reason, repeatYearly: yearly },
      {
        onSuccess: () => {
          toast.show(yearly ? "Chiusura aggiunta, ogni anno" : "Chiusura aggiunta");
          setAdding(false);
          setReason("");
          setYearly(false);
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  return (
    <Card className="mt-6 max-w-4xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gold">Calendario</span>
          <h2 className="mt-1 font-serif text-lg text-t1">Giorni di chiusura</h2>
          <p className="mt-1 text-sm text-t3">
            Ferragosto, le ferie della sede, un giorno di lavori: il team li vede nei turni.
          </p>
        </div>
        {canEdit && !adding ? (
          <Button onClick={() => setAdding(true)}>+ Aggiungi chiusura</Button>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-t3">Riposo settimanale</p>
        <div className="mt-2 flex gap-1.5">
          {WEEKDAYS.map((w) => {
            const on = rest.includes(w.iso);
            return (
              <button
                key={w.iso}
                type="button"
                aria-pressed={on}
                aria-label={`Chiusa il ${w.long}`}
                title={w.long}
                disabled={!canEdit || setRest.isPending}
                onClick={() => toggleRest(w.iso)}
                className={cn(
                  "focus-gold size-9 rounded-full border text-sm font-semibold transition disabled:cursor-default",
                  on ? "border-gold bg-gold text-gold-ink" : "border-border-2 bg-bg-2 text-t2 enabled:hover:text-t1"
                )}
              >
                {w.short}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-t4">
          {rest.length > 0
            ? "Quei giorni sono chiusi ogni settimana."
            : canEdit
              ? "Scegli i giorni in cui la sede è chiusa ogni settimana."
              : "Nessun giorno di riposo fisso."}
        </p>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-t3">Chiusure</p>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-t3">Nessuna chiusura in programma.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {upcoming.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border-2 bg-bg-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-t1">{closureRangeText(c)}</span>
                {c.reason ? <span className="block text-xs text-t3">{c.reason}</span> : null}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(c.id, {
                      onSuccess: () => toast.show("Chiusura tolta"),
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    })
                  }
                  className="focus-gold rounded-lg px-2 py-1 text-sm font-semibold text-gold hover:underline disabled:opacity-50"
                >
                  Togli
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && adding ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border-2 pt-4">
          <Field label="Dal">
            <Input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </Field>
          <Field label="Al">
            <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Motivo (facoltativo)">
            <Input
              value={reason}
              maxLength={80}
              placeholder="Es. Ferragosto"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm text-t2">
            <input
              type="checkbox"
              checked={yearly}
              onChange={(e) => setYearly(e.target.checked)}
              className="size-4 accent-[var(--color-gold)]"
            />
            Ogni anno
          </label>
          <Button variant="gold" disabled={save.isPending || !start} onClick={onSave}>
            {save.isPending ? "Salvo…" : "Aggiungi"}
          </Button>
          <Button onClick={() => setAdding(false)}>Annulla</Button>
        </div>
      ) : null}
    </Card>
  );
}
