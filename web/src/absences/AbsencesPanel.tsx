import { ListSkeleton } from "../ui/Skeleton";
import { PersonAvatar } from "../ui/PersonAvatar";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Absence, AbsenceKind } from "@/features/absences/api";
import { canCreditAbsence, creditSummary } from "@/features/absences/credits";
import {
  useAbsenceHourCredits,
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
  visibleAbsenceNote,
} from "@/features/absences/labels";
import { userErrorMessage } from "@/lib/errors";
import { todayString } from "@/lib/format";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { cn } from "@/lib/cn";
import { useToast } from "../ui/Toast";
import { Button, Field, Input, Pill } from "../ui/primitives";
import { AbsenceConflictsBlock } from "./AbsenceConflicts";
import { ResolveAbsenceForm, absencePillTone } from "./ResolveAbsenceForm";
import { AbsenceHourCredits } from "./AbsenceHourCredits";

/**
 * Ferie, permessi e malattie di una persona, nella scheda della dashboard:
 * elenco e «Registra assenza» (malattia comunicata a voce, ferie concordate).
 *
 * ⚠️ Gemello app in `src/features/absences/PersonAbsencesSection.tsx`.
 */
export function AbsencesPanel({ memberId }: { memberId: string }) {
  const {
    data,
    isPending,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = usePersonAbsences(memberId);
  const absences = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <RecordAbsenceForm memberId={memberId} />
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">
          Assenze
        </h3>
        {isPending ? (
          <ListSkeleton rows={3} label="Caricamento assenze…" />
        ) : absences.length === 0 ? (
          <p className="text-sm text-t4">
            Nessuna assenza. Le richieste di ferie e permessi arrivano in chat.
          </p>
        ) : (
          <>
            <AbsenceRows>
              {absences.map((a) => <AbsenceRow key={a.id} absence={a} />)}
            </AbsenceRows>
            {hasNextPage ? (
              <Button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="self-center"
              >
                {isFetchingNextPage ? "Caricamento…" : "Carica altre"}
              </Button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Il contenitore delle righe: un elenco unico a divisori, non una pila di card.
 * Le assenze si scorrono per confronto (chi, cosa, quando), e righe allineate
 * in colonna lo rendono possibile.
 */
export function AbsenceRows({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border-2 bg-bg-card">
      {children}
    </ul>
  );
}

/**
 * Una riga d'assenza con i comandi di chi gestisce: rispondere, il riferimento
 * del certificato, le ore riconosciute, i turni da liberare. La usano la scheda
 * persona e la pagina Assenze, sempre dentro `AbsenceRows`.
 *
 * Tre colonne da schermo largo — persona, assenza, comandi — e una sola su
 * quello stretto. I moduli si aprono sotto, allineati alla colonna centrale.
 */
export function AbsenceRow({
  absence: a,
  personName,
  impliedStatus,
}: {
  absence: Absence;
  /** La prima colonna, nelle liste con più persone. */
  personName?: string | null;
  /**
   * Lo stato che la sezione dice già («Da decidere», «In corso e prossime»):
   * su quelle righe la pill sarebbe la stessa parola ripetuta a ogni riga.
   */
  impliedStatus?: Absence["status"];
}) {
  const { canAny, isOwner, myMemberId } = useOwnerVenues();
  // Un solo pannello aperto per riga: i moduli restano chiusi finché servono,
  // così una lista di assenze resta una lista e non una colonna di form.
  const [open, setOpen] = useState<"credits" | "protocol" | null>(null);
  const closed = a.status === "rejected" || a.status === "withdrawn";
  const sick = a.kind === "malattia" && a.status === "approved";
  const creditable = canCreditAbsence(a, {
    canHours: canAny("can_view_hours"),
    isOwner,
    myMemberId,
  });
  const credits = useAbsenceHourCredits(creditable ? a.id : undefined);
  const days = absenceDays(a);
  const note = visibleAbsenceNote(a);
  const details = [
    note,
    a.resolution_note ? `Nota: ${a.resolution_note}` : null,
    sick
      ? a.inps_protocol
        ? `Certificato ${a.inps_protocol}`
        : "Certificato non indicato"
      : null,
    creditable && credits.data ? creditSummary(credits.data, days) : null,
  ].filter(Boolean);
  const showStatus = a.status !== impliedStatus;
  const toggle = (panel: "credits" | "protocol") =>
    setOpen((cur) => (cur === panel ? null : panel));
  // Il rientro dei moduli: sotto la colonna centrale, se c'è quella del nome.
  const indent = personName ? "md:pl-[11.5rem]" : "";

  return (
    <li className="px-4 py-3">
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1",
          personName && "md:grid-cols-[10rem_minmax(0,1fr)_auto]"
        )}
      >
        {personName ? (
          <div className="col-span-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-t1 md:col-span-1">
            <PersonAvatar personId={a.member_id} name={personName} size={28} />
            <span className="truncate">{personName}</span>
          </div>
        ) : null}

        <div className={cn("min-w-0", closed && "opacity-60")}>
          <p className="text-sm text-t1">
            <span className={personName ? undefined : "font-semibold"}>
              {ABSENCE_KIND_LABEL[a.kind]}
            </span>
            <span className="text-t3">
              {" · "}
              {formatAbsenceRange(a)}
              {a.start_time || days === 1 ? "" : ` · ${days} giorni`}
            </span>
          </p>
          {details.length > 0 ? (
            <p className="mt-0.5 text-xs text-t3">{details.join(" · ")}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-4 whitespace-nowrap">
          {open === null && creditable && credits.data ? (
            <RowLink onClick={() => toggle("credits")}>
              {credits.data.length > 0 ? "Modifica ore" : "Indica ore"}
            </RowLink>
          ) : null}
          {open === null && sick ? (
            <RowLink onClick={() => toggle("protocol")}>
              {a.inps_protocol ? "Modifica certificato" : "Aggiungi certificato"}
            </RowLink>
          ) : null}
          {showStatus ? (
            <Pill tone={absencePillTone(a.status)}>
              {ABSENCE_STATUS_LABEL[a.status]}
            </Pill>
          ) : null}
        </div>
      </div>

      <div className={indent}>
        {a.status === "pending" ? (
          <ResolveAbsenceForm absence={a} className="mt-3" />
        ) : null}
        {open === "credits" && credits.data ? (
          <AbsenceHourCredits
            absence={a}
            saved={credits.data}
            onDone={() => setOpen(null)}
          />
        ) : null}
        {open === "protocol" ? (
          <ProtocolField absence={a} onDone={() => setOpen(null)} />
        ) : null}
        {/* Su una assenza finita non c'è più niente da togliere, e ogni blocco
            è una query sui turni della persona. */}
        {a.end_date >= todayString() ? (
          <AbsenceConflictsBlock absence={a} />
        ) : null}
      </div>
    </li>
  );
}

/** Un comando di riga: testo in oro, senza il peso di un bottone. */
function RowLink({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-gold rounded text-xs font-semibold text-gold underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}

/** Il riferimento del certificato arriva spesso dopo: si aggiunge dalla riga. */
function ProtocolField({
  absence,
  onDone,
}: {
  absence: Absence;
  onDone: () => void;
}) {
  const toast = useToast();
  const save = useSetAbsenceInpsProtocol();
  const [value, setValue] = useState(absence.inps_protocol ?? "");
  const dirty = value.trim() !== (absence.inps_protocol ?? "");

  return (
    <form
      className="mt-3 flex items-center gap-2 rounded-xl bg-bg-1 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { absenceId: absence.id, protocol: value },
          {
            onSuccess: () => {
              toast.show("Riferimento salvato");
              onDone();
            },
            onError: (err) =>
              toast.show(userErrorMessage(err, "Salvataggio non riuscito"), "error"),
          }
        );
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Riferimento certificato medico"
        maxLength={40}
        className="max-w-60"
        autoFocus
      />
      <Button type="submit" variant="gold" disabled={!dirty || save.isPending}>
        Salva
      </Button>
      <Button onClick={onDone} disabled={save.isPending}>
        Annulla
      </Button>
    </form>
  );
}

function RecordAbsenceForm({ memberId }: { memberId: string }) {
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
        memberId,
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
          label="Riferimento certificato medico · facoltativo"
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
