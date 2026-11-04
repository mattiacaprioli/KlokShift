import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { userErrorMessage } from "@/lib/errors";
import { addMonthsToKey, formatMonthKey, monthKey } from "@/lib/format";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { operationsGate } from "@/features/workspace/access";
import {
  useSaveSurchargeRules,
  useSaveVenuePatron,
  useSurchargeRules,
} from "@/features/assignments/hooks";
import {
  BAND_ERROR,
  OVERTIME_HELP,
  PATRON_HELP,
  PCT_ERROR,
  SURCHARGES_HELP,
  isQuarterTime,
  parseSurchargePct,
  rulesChangeNote,
  rulesForMonth,
  type SurchargeRules,
  type SurchargeRulesInput,
} from "@/features/assignments/surcharges";
import { Button, Field, Input } from "../ui/primitives";
import { useToast } from "../ui/Toast";

/**
 * Le regole delle maggiorazioni (equivalente web di `(manager)/maggiorazioni`):
 * versioni mensili dell'azienda e patrono di ogni sede. Le ore le calcola il
 * database; qui si scrivono solo le regole.
 */
export function SurchargeRulesDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const query = useSurchargeRules(workspaceId);
  const { venues, isOwner, can } = useOwnerVenues();
  const current = monthKey();
  const minMonth = addMonthsToKey(current, -12);
  const [month, setMonth] = useState(current);
  const hourVenues = venues.filter((v) => isOwner || can(v.id, "can_view_hours"));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label="Maggiorazioni"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-2 bg-bg-card p-6"
      >
        <h2 className="font-serif text-lg text-t1">Maggiorazioni</h2>
        <p className="mt-2 text-sm leading-5 text-t2">{SURCHARGES_HELP}</p>
        {query.isPending ? (
          <p className="mt-5 text-sm text-t3">Caricamento…</p>
        ) : query.isError ? (
          <p className="mt-5 text-sm text-error">{userErrorMessage(query.error)}</p>
        ) : (
          <>
            <div className="mt-5 flex items-center gap-3">
              <span className="text-xs text-t3">Valgono dal mese di</span>
              <div className="flex items-center rounded-full border border-border-2 bg-bg-1">
                <button
                  type="button"
                  aria-label="Mese prima"
                  disabled={month <= minMonth}
                  onClick={() => setMonth((m) => addMonthsToKey(m, -1))}
                  className="focus-gold px-3 py-1.5 text-gold disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="min-w-[140px] text-center text-sm font-semibold text-t1">
                  {formatMonthKey(month)}
                </span>
                <button
                  type="button"
                  aria-label="Mese dopo"
                  disabled={month >= current}
                  onClick={() => setMonth((m) => addMonthsToKey(m, 1))}
                  className="focus-gold px-3 py-1.5 text-gold disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            </div>
            {rulesChangeNote(query.data.versions, month, current) ? (
              <p className="mt-2 text-xs text-warning">
                {rulesChangeNote(query.data.versions, month, current)}
              </p>
            ) : null}
            <RulesForm
              key={month}
              workspaceId={workspaceId}
              month={month}
              initial={rulesForMonth(query.data.versions, month)}
              onClose={onClose}
            />
            {hourVenues.length > 0 ? (
              <PatronsForm workspaceId={workspaceId} venues={hourVenues} patrons={query.data.patrons} />
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const pctInput = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

function RulesForm({
  workspaceId,
  month,
  initial,
  onClose,
}: {
  workspaceId: string;
  month: string;
  initial: SurchargeRulesInput;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveSurchargeRules(workspaceId);
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const [night, setNight] = useState(pctInput(initial.night_pct));
  const [start, setStart] = useState(initial.night_start);
  const [end, setEnd] = useState(initial.night_end);
  const [sunday, setSunday] = useState(pctInput(initial.sunday_pct));
  const [holiday, setHoliday] = useState(pctInput(initial.holiday_pct));
  const [overtime, setOvertime] = useState(pctInput(initial.overtime_pct));

  const parsed = {
    night: parseSurchargePct(night),
    sunday: parseSurchargePct(sunday),
    holiday: parseSurchargePct(holiday),
    overtime: parseSurchargePct(overtime),
  };
  const badBand = !isQuarterTime(start) || !isQuarterTime(end) || start.trim() === end.trim();
  const invalid = Object.values(parsed).some((p) => p.invalid) || badBand;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || save.isPending || !gate.allowed) return;
    save.mutate(
      {
        validFrom: `${month}-01`,
        rules: {
          night_pct: parsed.night.pct,
          night_start: start.trim(),
          night_end: end.trim(),
          sunday_pct: parsed.sunday.pct,
          holiday_pct: parsed.holiday.pct,
          overtime_pct: parsed.overtime.pct,
        },
      },
      { onSuccess: () => toast.show("Maggiorazioni salvate") }
    );
  }

  const pct = (label: string, value: string, set: (v: string) => void, bad: boolean, hint?: string) => (
    <Field label={`${label} (%)`} error={bad ? PCT_ERROR : undefined} hint={hint}>
      <Input
        value={value}
        inputMode="decimal"
        placeholder="Spenta"
        disabled={!gate.allowed}
        onChange={(e) => set(e.target.value)}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        {pct("Notturno", night, setNight, parsed.night.invalid)}
        <Field label="Dalle" error={badBand ? BAND_ERROR : undefined}>
          <Input value={start} placeholder="22:00" disabled={!gate.allowed} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Alle">
          <Input value={end} placeholder="06:00" disabled={!gate.allowed} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {pct("Domenica", sunday, setSunday, parsed.sunday.invalid)}
        {pct("Festivi", holiday, setHoliday, parsed.holiday.invalid)}
      </div>
      {pct("Straordinario", overtime, setOvertime, parsed.overtime.invalid, OVERTIME_HELP)}
      {save.error ? (
        <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          {userErrorMessage(save.error)}
        </p>
      ) : null}
      {gate.allowed ? null : <p className="text-sm text-t3">{gate.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {gate.allowed ? (
          <Button type="submit" variant="gold" disabled={save.isPending || invalid}>
            {save.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        ) : null}
        <Button onClick={onClose}>Chiudi</Button>
      </div>
    </form>
  );
}

function PatronsForm({
  workspaceId,
  venues,
  patrons,
}: {
  workspaceId: string;
  venues: { id: string; name: string }[];
  patrons: SurchargeRules["patrons"];
}) {
  const toast = useToast();
  const save = useSaveVenuePatron(workspaceId);
  const { access, isOwner } = useOwnerVenues();
  const gate = operationsGate(access, { isOwner });
  const initial = (venueId: string) => patrons.find((p) => p.venue_id === venueId);
  const [values, setValues] = useState<Record<string, { day: string; month: string }>>(() => {
    const out: Record<string, { day: string; month: string }> = {};
    for (const v of venues) {
      const p = initial(v.id);
      out[v.id] = { day: p ? String(p.day) : "", month: p ? String(p.month) : "" };
    }
    return out;
  });

  async function onSave() {
    try {
      for (const v of venues) {
        const cur = values[v.id];
        const p = initial(v.id);
        const day = cur.day.trim() === "" ? null : Number(cur.day);
        const mon = cur.month.trim() === "" ? null : Number(cur.month);
        if (day === (p?.day ?? null) && mon === (p?.month ?? null)) continue;
        await save.mutateAsync({ venueId: v.id, day, month: mon });
      }
      toast.show("Patroni salvati");
    } catch (e) {
      toast.show(userErrorMessage(e), "error");
    }
  }

  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-border-2 pt-5">
      <h3 className="text-sm font-semibold text-t1">Santo patrono</h3>
      <p className="text-xs text-t3">{PATRON_HELP}</p>
      {venues.map((v) => (
        <div key={v.id} className="grid grid-cols-[1fr_80px_80px] items-end gap-3">
          <span className="pb-2 text-sm text-t1">{v.name}</span>
          <Field label="Giorno">
            <Input
              value={values[v.id]?.day ?? ""}
              inputMode="numeric"
              maxLength={2}
              disabled={!gate.allowed}
              onChange={(e) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], day: e.target.value } }))}
            />
          </Field>
          <Field label="Mese">
            <Input
              value={values[v.id]?.month ?? ""}
              inputMode="numeric"
              maxLength={2}
              disabled={!gate.allowed}
              onChange={(e) => setValues((prev) => ({ ...prev, [v.id]: { ...prev[v.id], month: e.target.value } }))}
            />
          </Field>
        </div>
      ))}
      {gate.allowed ? (
        <div>
          <Button onClick={() => void onSave()} disabled={save.isPending}>
            Salva i patroni
          </Button>
        </div>
      ) : null}
    </section>
  );
}
