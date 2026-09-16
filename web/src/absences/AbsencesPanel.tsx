import { useState, type FormEvent } from "react";
import type { Absence, AbsenceKind } from "@/features/absences/api";
import {
  usePersonAbsences,
  useRecordAbsence,
  useSetAbsenceInpsProtocol,
} from "@/features/absences/hooks";
import {
  ABSENCE_KINDS,
  ABSENCE_KIND_LABEL,
  ABSENCE_STATUS_LABEL,
  absenceDays,
  formatAbsenceRange,
} from "@/features/absences/labels";
import { userErrorMessage } from "@/lib/errors";
import { todayString } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Card, Field, Input, Pill, Spinner } from "../ui/primitives";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceForm, absencePillTone } from "./ResolveAbsenceForm";

/**
 * Ferie, permessi e malattie di una persona, nella scheda della dashboard:
 * elenco e «Registra assenza» (malattia comunicata a voce, ferie concordate).
 *
 * ⚠️ Gemello app in `src/features/absences/PersonAbsencesSection.tsx`.
 */
export function AbsencesPanel({ personId }: { personId: string }) {
  const { data, isPending } = usePersonAbsences(personId);
  const absences = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <RecordAbsenceForm personId={personId} />
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">
          Assenze
        </h3>
        {isPending ? (
          <Spinner />
        ) : absences.length === 0 ? (
          <p className="text-sm text-t4">
            Nessuna assenza. Le richieste di ferie e permessi arrivano in chat.
          </p>
        ) : (
          absences.map((a) => <AbsenceRow key={a.id} absence={a} />)
        )}
      </section>
    </div>
  );
}

/**
 * Una riga d'assenza con i comandi di chi gestisce: rispondere, il protocollo,
 * i turni da liberare. La usano la scheda persona e la pagina Assenze.
 */
export function AbsenceRow({
  absence: a,
  personName,
}: {
  absence: Absence;
  /** In testa alla riga, nelle liste con più persone. */
  personName?: string | null;
}) {
  const closed = a.status === "rejected" || a.status === "withdrawn";
  const sick = a.kind === "malattia";
  const days = absenceDays(a);
  return (
    <Card className={cn("p-3", closed && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {personName ? (
            <p className="mb-0.5 truncate text-sm font-semibold text-t1">
              {personName}
            </p>
          ) : null}
          <p
            className={cn(
              "text-sm",
              personName ? "text-t2" : "font-semibold text-t1"
            )}
          >
            {ABSENCE_KIND_LABEL[a.kind]}
            {a.start_time ? "" : ` · ${days} ${days === 1 ? "giorno" : "giorni"}`}
          </p>
          <p className="mt-0.5 text-xs text-t4">{formatAbsenceRange(a)}</p>
          {a.note ? <p className="mt-1 text-xs text-t2">{a.note}</p> : null}
          {a.resolution_note ? (
            <p className="mt-1 text-xs text-t4">Nota: {a.resolution_note}</p>
          ) : null}
        </div>
        <Pill tone={absencePillTone(a.status)}>
          {ABSENCE_STATUS_LABEL[a.status]}
        </Pill>
      </div>
      {a.status === "pending" ? (
        <ResolveAbsenceForm absence={a} className="mt-3" />
      ) : null}
      {sick && a.status === "approved" ? <ProtocolField absence={a} /> : null}
      {/* Su una assenza finita non c'è più niente da togliere, e ogni blocco è
          una query sui turni della persona. */}
      {a.end_date >= todayString() ? <AbsenceConflictsBlock absence={a} /> : null}
    </Card>
  );
}

/** Il protocollo del certificato arriva spesso dopo: si aggiunge dalla riga. */
function ProtocolField({ absence }: { absence: Absence }) {
  const toast = useToast();
  const save = useSetAbsenceInpsProtocol();
  const [value, setValue] = useState(absence.inps_protocol ?? "");
  const dirty = value.trim() !== (absence.inps_protocol ?? "");

  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { absenceId: absence.id, protocol: value },
          {
            onSuccess: () => toast.show("Protocollo salvato"),
            onError: (err) =>
              toast.show(userErrorMessage(err, "Salvataggio non riuscito"), "error"),
          }
        );
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Protocollo INPS"
        maxLength={40}
        className="max-w-60"
      />
      <Button type="submit" disabled={!dirty || save.isPending}>
        Salva
      </Button>
    </form>
  );
}

function RecordAbsenceForm({ personId }: { personId: string }) {
  const toast = useToast();
  const record = useRecordAbsence();
  const today = todayString();
  const [kind, setKind] = useState<AbsenceKind>("malattia");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [hourly, setHourly] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [note, setNote] = useState("");
  const [protocol, setProtocol] = useState("");

  const sick = kind === "malattia";
  const isHourly = kind === "permesso" && hourly;
  const invalid =
    !start ||
    (!isHourly && (!end || end < start)) ||
    (isHourly && (!startTime || !endTime || endTime <= startTime));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    record.mutate(
      {
        personId,
        kind,
        startDate: start,
        endDate: isHourly ? start : end,
        startTime: isHourly ? startTime : null,
        endTime: isHourly ? endTime : null,
        note: sick ? null : note,
        inpsProtocol: sick ? protocol : null,
      },
      {
        onSuccess: () => {
          toast.show("Assenza registrata");
          setNote("");
          setProtocol("");
        },
        onError: (err) =>
          toast.show(userErrorMessage(err, "Salvataggio non riuscito"), "error"),
      }
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">
        Registra assenza
      </h3>
      <p className="text-xs text-t4">
        Per la malattia comunicata a voce o le ferie già concordate: nasce
        approvata, senza messaggio in chat.
      </p>
      <div className="flex gap-1">
        {ABSENCE_KINDS.map((k) => (
          <Button
            key={k.id}
            type="button"
            variant={kind === k.id ? "gold" : "ghost"}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </Button>
        ))}
      </div>
      {kind === "permesso" ? (
        <label className="flex items-center gap-2 text-sm text-t2">
          <input
            type="checkbox"
            checked={hourly}
            onChange={(e) => setHourly(e.target.checked)}
          />
          A ore
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={isHourly ? "Giorno" : "Dal"}>
          <Input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
          />
        </Field>
        {isHourly ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Dalle">
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label="Alle">
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label="Al">
            <Input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        )}
      </div>
      {sick ? (
        <Field
          label="Protocollo INPS · facoltativo"
          hint="Mai diagnosi o informazioni sulla salute: servono solo le date."
        >
          <Input
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            maxLength={40}
          />
        </Field>
      ) : (
        <Field label="Nota · facoltativa">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
          />
        </Field>
      )}
      <div>
        <Button
          type="submit"
          variant="gold"
          disabled={invalid || record.isPending}
        >
          {record.isPending ? "Salvataggio…" : "Registra"}
        </Button>
      </div>
    </form>
  );
}
