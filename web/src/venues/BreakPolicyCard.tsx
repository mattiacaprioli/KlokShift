import type { Venue } from "@/features/venues/api";
import {
  useSetVenueBreakClocked,
  useSetVenueBreakPolicy,
} from "@/features/clock/hooks";
import {
  BREAK_CLOCKED_COPY,
  BREAK_CLOCKED_LABEL,
  BREAK_POLICY_COPY,
  BREAK_RULE_MINUTES,
  BREAK_RULE_THRESHOLDS,
  DEFAULT_BREAK_RULE,
} from "@/features/shifts/breaks";
import { userErrorMessage } from "@/lib/errors";
import { formatBreakMinutes } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, Select } from "../ui/primitives";
import { useToast } from "../ui/Toast";

type Policy = {
  paid: boolean;
  ruleAfterMinutes: number | null;
  ruleMinutes: number | null;
};

/**
 * Pausa retribuita o no, e la regola che la propone nei turni lunghi: per chi
 * ha il permesso Ore, come il metodo di timbratura. Ogni scelta salva.
 */
export function BreakPolicyCard({
  venue,
  embedded = false,
}: {
  venue: Venue;
  /** Nel modal sede usa il contenitore del pannello. */
  embedded?: boolean;
}) {
  const save = useSetVenueBreakPolicy();
  const saveClocked = useSetVenueBreakClocked();
  const toast = useToast();
  const current: Policy = {
    paid: venue.break_paid,
    ruleAfterMinutes: venue.break_rule_after_minutes,
    ruleMinutes: venue.break_rule_minutes,
  };
  const ruleOn = current.ruleAfterMinutes != null;

  function update(next: Partial<Policy>) {
    save.mutate(
      { venueId: venue.id, ...current, ...next },
      { onError: (error) => toast.show(userErrorMessage(error), "error") }
    );
  }

  const content = (
    <section>
      <span className="text-xs font-semibold uppercase tracking-wider text-gold">
        Pausa
      </span>
      <h2 className="mt-1 font-serif text-lg text-t1">
        La pausa è retribuita?
      </h2>
      <div
        role="radiogroup"
        aria-label={`Pausa retribuita a ${venue.name}`}
        className="mt-3 inline-flex gap-1 rounded-xl border border-border-2 bg-bg-1 p-1"
      >
        {[
          { paid: false, label: "Non retribuita" },
          { paid: true, label: "Retribuita" },
        ].map((option) => {
          const active = option.paid === current.paid;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={save.isPending}
              onClick={() => {
                if (!active) update({ paid: option.paid });
              }}
              className={cn(
                "focus-gold rounded-lg px-4 py-1.5 text-sm transition",
                active ? "bg-bg-2 font-semibold text-t1" : "text-t3 hover:text-t1"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-sm leading-5 text-t3">
        {current.paid ? BREAK_POLICY_COPY.paid : BREAK_POLICY_COPY.unpaid}
      </p>

      <div className="mt-5 border-t border-border-2 pt-4">
        <h3 className="text-sm font-semibold text-t1">Come si registra</h3>
        <div
          role="radiogroup"
          aria-label={`Come si registra la pausa a ${venue.name}`}
          className="mt-2 inline-flex gap-1 rounded-xl border border-border-2 bg-bg-1 p-1"
        >
          {[
            { clocked: true, label: BREAK_CLOCKED_LABEL.clocked },
            { clocked: false, label: BREAK_CLOCKED_LABEL.fixed },
          ].map((option) => {
            const active = option.clocked === venue.break_clocked;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saveClocked.isPending}
                onClick={() => {
                  if (active) return;
                  saveClocked.mutate(
                    { venueId: venue.id, clocked: option.clocked },
                    { onError: (error) => toast.show(userErrorMessage(error), "error") }
                  );
                }}
                className={cn(
                  "focus-gold rounded-lg px-4 py-1.5 text-sm transition",
                  active ? "bg-bg-2 font-semibold text-t1" : "text-t3 hover:text-t1"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm leading-5 text-t3">
          {venue.break_clocked ? BREAK_CLOCKED_COPY.clocked : BREAK_CLOCKED_COPY.fixed}{" "}
          {BREAK_CLOCKED_COPY.note}
        </p>
      </div>

      <div className="mt-5 border-t border-border-2 pt-4">
        <label className="flex items-start gap-3 text-sm text-t1">
          <input
            type="checkbox"
            checked={ruleOn}
            disabled={save.isPending}
            onChange={(event) =>
              update(
                event.target.checked
                  ? {
                      ruleAfterMinutes: DEFAULT_BREAK_RULE.afterMinutes,
                      ruleMinutes: DEFAULT_BREAK_RULE.minutes,
                    }
                  : { ruleAfterMinutes: null, ruleMinutes: null }
              )
            }
            className="mt-1 accent-gold"
          />
          <span>
            <span className="font-semibold">Proponi una pausa nei turni lunghi</span>
            <span className="mt-0.5 block text-xs leading-5 text-t3">
              {BREAK_POLICY_COPY.rule}
            </span>
          </span>
        </label>
        {ruleOn ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-sm text-t2">
            <span>Nei turni oltre</span>
            <Select
              aria-label="Soglia della pausa"
              value={current.ruleAfterMinutes ?? DEFAULT_BREAK_RULE.afterMinutes}
              disabled={save.isPending}
              onChange={(event) =>
                update({ ruleAfterMinutes: Number(event.target.value) })
              }
              className="w-auto"
            >
              {BREAK_RULE_THRESHOLDS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes / 60} ore
                </option>
              ))}
            </Select>
            <span>una pausa di</span>
            <Select
              aria-label="Durata della pausa"
              value={current.ruleMinutes ?? DEFAULT_BREAK_RULE.minutes}
              disabled={save.isPending}
              onChange={(event) =>
                update({ ruleMinutes: Number(event.target.value) })
              }
              className="w-auto"
            >
              {BREAK_RULE_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatBreakMinutes(minutes)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-t4">{BREAK_POLICY_COPY.note}</p>
    </section>
  );

  return embedded ? content : <Card className="mt-6 max-w-2xl">{content}</Card>;
}
