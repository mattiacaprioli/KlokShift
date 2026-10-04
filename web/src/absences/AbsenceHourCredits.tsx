import { useState, type FormEvent } from "react";
import type { Absence, AbsenceHourCredit } from "@/features/absences/api";
import {
  absenceDates,
  creditChanges,
  creditDraftOf,
  fillEmptyCredits,
  parseCreditHours,
} from "@/features/absences/credits";
import { useSetAbsenceHourCredits } from "@/features/absences/hooks";
import { userErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Input } from "../ui/primitives";

/**
 * Le ore riconosciute, un campo per giorno; nessuna conversione implicita.
 * Si apre dalla riga dell'assenza e si chiude salvando.
 *
 * ⚠️ Gemello app: `CreditModal` in `src/features/absences/AbsenceList.tsx`.
 */
export function AbsenceHourCredits({
  absence,
  saved,
  onDone,
}: {
  absence: Absence;
  saved: readonly AbsenceHourCredit[];
  onDone: () => void;
}) {
  const toast = useToast();
  const save = useSetAbsenceHourCredits();
  const dates = absenceDates(absence);
  const [draft, setDraft] = useState(() => creditDraftOf(dates, saved));
  const [same, setSame] = useState("");
  const changes = creditChanges(draft, saved);
  const conflictOn = new Set(saved.filter((c) => c.conflict).map((c) => c.date));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!changes || changes.length === 0) return;
    save.mutate(
      { absenceId: absence.id, changes },
      {
        onSuccess: () => {
          toast.show("Ore riconosciute salvate");
          onDone();
        },
        onError: (err) =>
          toast.show(userErrorMessage(err, "Salvataggio non riuscito"), "error"),
      }
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl bg-bg-1 p-3">
      <p className="text-xs text-t4">
        Le ore da riconoscere per ciascun giorno. Un giorno lasciato vuoto non
        viene convertito in ore.
      </p>
      {dates.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Stesse ore per tutti i giorni"
            inputMode="decimal"
            placeholder="Ore, es. 8"
            value={same}
            onChange={(e) => setSame(e.target.value)}
            className="w-28"
          />
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={parseCreditHours(same) == null}
            onClick={() => setDraft((d) => fillEmptyCredits(d, same.trim()))}
          >
            Compila i giorni vuoti
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
        {dates.map((d) => {
          const invalid = parseCreditHours(draft[d]) === undefined;
          return (
            <label key={d} className="flex flex-col gap-1">
              <span className="text-xs text-t3">
                {formatDate(d)}
                {conflictOn.has(d) ? (
                  <span className="text-gold"> · da verificare</span>
                ) : null}
              </span>
              <Input
                inputMode="decimal"
                placeholder="—"
                value={draft[d]}
                aria-invalid={invalid}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [d]: e.target.value }))
                }
                className={cn("w-24", invalid && "border-error")}
              />
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="gold"
          disabled={!changes || changes.length === 0 || save.isPending}
        >
          {save.isPending ? "Salvataggio…" : "Salva ore"}
        </Button>
        <Button onClick={onDone} disabled={save.isPending}>
          Annulla
        </Button>
      </div>
    </form>
  );
}
