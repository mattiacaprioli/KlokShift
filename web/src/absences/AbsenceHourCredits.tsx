import { useState, type FormEvent } from "react";
import type { Absence } from "@/features/absences/api";
import { useAbsenceHourCredits, useSetAbsenceHourCredit } from "@/features/absences/hooks";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "../ui/Toast";
import { Button, Input } from "../ui/primitives";

/** Ore riconosciute inserite giorno per giorno; nessuna conversione implicita. */
export function AbsenceHourCredits({ absence }: { absence: Absence }) {
  const query = useAbsenceHourCredits(absence.id);
  const save = useSetAbsenceHourCredit();
  const toast = useToast();
  const [date, setDate] = useState(absence.start_date);
  const [hours, setHours] = useState("");
  const number = Number(hours.replace(",", "."));
  const valid = date >= absence.start_date && date <= absence.end_date &&
    Number.isFinite(number) && number > 0 && number <= 24 && Number.isInteger(number * 60);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    save.mutate({ absenceId: absence.id, date, minutes: number * 60 }, {
      onSuccess: () => { setHours(""); toast.show("Ore riconosciute salvate"); },
      onError: (err) => toast.show(userErrorMessage(err, "Salvataggio non riuscito"), "error"),
    });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs font-semibold text-t2">Ore di assenza riconosciute</p>
      <p className="mt-1 text-xs text-t4">Indica solo le ore da riconoscere per ciascun giorno. I giorni senza ore non vengono convertiti automaticamente.</p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
        <Input aria-label="Giorno dell'assenza" type="date" min={absence.start_date} max={absence.end_date} value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        <Input aria-label="Ore riconosciute" type="text" inputMode="decimal" placeholder="Ore, es. 8" value={hours} onChange={(e) => setHours(e.target.value)} className="w-28" />
        <Button type="submit" disabled={!valid || save.isPending}>Salva ore</Button>
      </form>
      {query.data?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {query.data.map((c) => (
            <div key={c.date} className="flex items-center gap-2 rounded-lg bg-bg-2 px-2 py-1 text-xs text-t2">
              <span>{c.date} · {(c.minutes / 60).toLocaleString("it-IT")} h{c.conflict ? " · Da verificare" : ""}</span>
              <button type="button" aria-label={`Rimuovi le ore del ${c.date}`} disabled={save.isPending} className="text-t4 hover:text-t1" onClick={() => save.mutate({ absenceId: absence.id, date: c.date, minutes: null })}>×</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
