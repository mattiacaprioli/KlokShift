import { TableSkeleton } from "../ui/Skeleton";
import { PersonAvatar } from "../ui/PersonAvatar";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { companyName } from "@/features/venues/companyName";
import { useHoursToFix, useOwnerHoursSummary } from "@/features/assignments/hooks";
import {
  HOURS_TO_FIX_HINT,
  HOURS_TO_FIX_TITLE,
  hourToFixLabel,
  hourToFixWhen,
  hoursToFixSummary,
} from "@/features/assignments/hoursToFix";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import {
  breakSummaryText,
  exportAvailability,
  monthlyReportRows,
} from "@/features/assignments/monthlyReport";
import { useOwnerAbsenceSummary } from "@/features/absences/hooks";
import {
  ABSENCE_SUMMARY_NOTE,
  missingCertificatesWarning,
} from "@/features/absences/summary";
import {
  absencesFileName,
  buildAbsencesCsv,
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";
import {
  filterByPeople,
  monthAsRange,
  peopleInReport,
  periodLabel,
  pruneSelection,
  selectedNames,
  validateRange,
  type ReportPeriod,
} from "@/features/assignments/reportPeriod";
import { addMonthsToKey, formatHours, todayString } from "@/lib/format";
import { cn } from "@/lib/cn";
import { monthKey } from "../lib/week";
import { PeopleSelect } from "../hours/PeopleSelect";
import {
  Button,
  Card,
  Input,
  PageHeader,
  Placeholder,
  QueryError,
  StickyHeader,
} from "../ui/primitives";
import { FullExportCard } from "../export/FullExportCard";
import { RecordPastShiftDialog } from "../shifts/RecordPastShiftDialog";
import { RECORD_ACTION } from "@/features/shifts/recorded";
import { useApproveRegularClockRecords, useRegularClockCount } from "@/features/clock/hooks";
import { approveRegularLabel, approvedRegularToast } from "@/features/clock/autoApprove";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "../ui/Toast";
import { NoVenues } from "../venues/NoVenues";

/**
 * Le ore di **tutta l'azienda** in un mese o fra due date, una riga per
 * persona; si può restringere a una persona o a un gruppo. Periodo e persone
 * valgono per la pagina **e** per gli export: il file è quello che si vede.
 *
 * Nessun selettore di sede e nessuno split: chi lavora in due sedi dello stesso
 * titolare ha **una** busta paga, e il numero che serve è il totale. Fino al
 * 14/09/2026 ogni riga si apriva sul dettaglio per sede; è stato tolto perché
 * rispondeva a una domanda che questa pagina non fa — esiste per pagare le
 * persone, non per allocare il costo fra le sedi.
 */
/** Righe di «Ore da sistemare» visibili prima di «Mostra tutti». */
const TO_FIX_PREVIEW = 8;

export function OrePage() {
  const { profile } = useAuth();
  const { workspaceId, venues, historyVenues, canUseOperations, canAny, isMultiVenue } =
    useOwnerVenues();
  const navigate = useNavigate();
  // Il turno dimenticato si registra da qui: è una questione di ore, ed è qui
  // che ci si accorge che mancano (come dal foglio ore di 7shifts o Deputy).
  const canRecord = canUseOperations && canAny("can_view_hours");
  const [recording, setRecording] = useState(false);
  const [month, setMonth] = useState(monthKey(new Date()));
  const [mode, setMode] = useState<"month" | "range">("month");
  // `range` è quello nei campi, `applied` l'ultimo valido: con le date
  // sbagliate la pagina resta sul periodo di prima, niente query a vuoto.
  const [range, setRange] = useState(() => monthAsRange(monthKey(new Date())));
  const [applied, setApplied] = useState(range);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const adjacentMonth = (offset: number) => addMonthsToKey(month, offset);
  const rangeError = mode === "range" ? validateRange(range.from, range.to) : null;
  const period: ReportPeriod =
    mode === "month" ? { kind: "month", month } : { kind: "range", ...applied };

  function editRange(next: { from: string; to: string }) {
    setRange(next);
    if (!validateRange(next.from, next.to)) setApplied(next);
  }
  const { data, isPending, isError, error } = useOwnerHoursSummary(
    workspaceId,
    period
  );

  const allRows = data ?? [];
  const absenceQuery = useOwnerAbsenceSummary(workspaceId, period);
  const allAbsences = absenceQuery.data ?? [];
  // Si sceglie fra chi nel periodo ha ore o assenze; chi non c'è più esce
  // dalla selezione da solo, senza effetti.
  const options = peopleInReport(allRows, allAbsences);
  const selection = pruneSelection(chosen, options);
  const names = selectedNames(selection, options);
  const rows = filterByPeople(allRows, selection);
  // La RPC torna righe (persona × sede); questa le somma per persona, ed è
  // quello che si mostra. Lo split resta nei dati (serve a comporre i ruoli) e
  // non arriva in pagina.
  const people = groupHoursByPerson(rows);
  const totalHours = people.reduce((s, p) => s + p.hours, 0);
  const toReview = people.reduce((s, p) => s + p.to_review_count, 0);
  // I turni del periodo le cui ore non contano ancora, con il perché: anche chi
  // doveva timbrare e non l'ha fatto, che il riepilogo non nomina.
  const toFix = useHoursToFix(workspaceId, period).data ?? [];
  // Le timbrature in orario del periodo, approvate in un clic invece di aprire
  // i turni uno per uno (decisione del 30/10, come l'«Approve All» dei concorrenti).
  const regularCount = useRegularClockCount(workspaceId, period, toFix.length > 0).data ?? 0;
  const approveRegular = useApproveRegularClockRecords();
  const toast = useToast();
  function onApproveRegular() {
    if (!workspaceId) return;
    approveRegular.mutate(
      { workspaceId, period },
      {
        onSuccess: (n) => toast.show(approvedRegularToast(n)),
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }
  const [showAllToFix, setShowAllToFix] = useState(false);
  const toFixShown = showAllToFix ? toFix : toFix.slice(0, TO_FIX_PREVIEW);
  const label = periodLabel(period);
  const company = companyName(venues.length > 0 ? venues : historyVenues, profile?.full_name);
  // Ferie, permessi e malattia del periodo: ore nel consuntivo, giorni nel dettaglio.
  const absences = filterByPeople(allAbsences, selection);
  const report = monthlyReportRows(people, absences);
  const certificatesWarning = missingCertificatesWarning(absences);
  const totalJustified = report.reduce((s, p) => s + p.justified_hours, 0);
  const totalCoveredHours = report.reduce((s, p) => s + p.covered_hours, 0);
  const totalConflicts = report.reduce((s, p) => s + p.conflict_hours, 0);
  const totalUntracked = report.reduce((s, p) => s + p.untracked_hours, 0);
  const canExport = exportAvailability({
    hoursReady: !isPending && !isError,
    absencesReady: !absenceQuery.isPending && !absenceQuery.isError,
    reportRows: report.length,
    absenceRows: absences.length,
  });

  function download(content: string, fileName: string) {
    // Stesse funzioni pure dell'app: i file devono coincidere.
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    if (!canExport.monthly) return;
    download(
      buildHoursCsv(people, absences),
      hoursFileName(company, label, "csv", names)
    );
  }

  function downloadAbsencesCsv() {
    if (!canExport.absences) return;
    download(
      buildAbsencesCsv(absences),
      absencesFileName(company, label, "csv", names)
    );
  }

  function printPdf() {
    if (!canExport.monthly) return;
    // Sul web il PDF lo fa il browser: stesso HTML che l'app manda a expo-print.
    const html = buildHoursHtml(
      company,
      label,
      people,
      totalHours,
      absences,
      names
    );
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  // Le sedi chiuse hanno ancora le loro ore: il vuoto è solo senza nessuna sede.
  if (venues.length === 0 && historyVenues.length === 0) {
    return (
      <>
        <PageHeader title="Ore" />
        <NoVenues detail="Le ore arrivano dai turni: apri una sede per iniziare a programmarli." />
      </>
    );
  }

  return (
    <>
      <StickyHeader>
        <PageHeader
          title="Ore"
          subtitle={`${label} · ${formatHours(totalHours)} lavorate effettive${toFix.length > 0 ? ` · ${toFix.length} ${toFix.length === 1 ? "turno" : "turni"} da sistemare` : ""}`}
          actions={
            canRecord ? (
              <Button variant="gold" onClick={() => setRecording(true)}>
                {RECORD_ACTION}
              </Button>
            ) : undefined
          }
        />
        {recording ? (
          <RecordPastShiftDialog onClose={() => setRecording(false)} />
        ) : null}

        {/* Una riga sotto il titolo, come i filtri dello Storico. Niente
            `items-center`: lo stretch dà a frecce, tendina e bottoni la stessa
            altezza anche se il glifo della freccia è più alto del testo. */}
        <div className="mb-5 flex flex-wrap justify-between gap-3 print:hidden">
          {/* Frecce per il mese accanto (il caso di tutti i mesi: chiudere il
              precedente), tendina per saltare. Le pillole andavano a capo. */}
          <div className="flex flex-wrap gap-2">
            {/* Mese (il caso di tutti i mesi) o due date libere, per mandare
                al consulente anche una quindicina o un periodo a cavallo. */}
            <div
              role="group"
              aria-label="Periodo"
              className="flex rounded-xl border border-border-2 bg-bg-2 p-0.5"
            >
              {(
                [
                  ["month", "Mese"],
                  ["range", "Date"],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mode === id}
                  onClick={() => {
                    // Si entra in «Date» dal mese che si stava guardando.
                    if (id === "range" && mode === "month") editRange(monthAsRange(month));
                    setMode(id);
                  }}
                  className={cn(
                    "focus-gold rounded-[10px] px-3 text-sm font-semibold transition",
                    mode === id ? "bg-bg-card text-t1 shadow-sm" : "text-t3 hover:text-t1"
                  )}
                >
                  {text}
                </button>
              ))}
            </div>

            {mode === "month" ? (
              <div className="flex gap-2">
                <Button
                  aria-label="Mese precedente"
                  onClick={() => setMonth(adjacentMonth(-1))}
                >
                  ←
                </Button>
                <input
                  type="month"
                  aria-label="Mese"
                  value={month}
                  max={monthKey(new Date())}
                  onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}
                  className="rounded-xl border border-border-2 bg-bg-card px-3 text-sm text-t1"
                />
                <Button
                  aria-label="Mese successivo"
                  onClick={() => setMonth(adjacentMonth(1))}
                  disabled={month >= monthKey(new Date())}
                >
                  →
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    aria-label="Dal"
                    value={range.from}
                    max={range.to || todayString()}
                    onChange={(e) => editRange({ ...range, from: e.target.value })}
                    className="w-auto"
                  />
                  <span className="text-sm text-t3">–</span>
                  <Input
                    type="date"
                    aria-label="Al"
                    value={range.to}
                    min={range.from || undefined}
                    onChange={(e) => editRange({ ...range, to: e.target.value })}
                    className="w-auto"
                  />
                </div>
                {rangeError ? (
                  <p role="alert" className="text-xs text-error">{rangeError}</p>
                ) : null}
              </div>
            )}

            <PeopleSelect options={options} value={selection} onChange={setChosen} />
          </div>

          <div className="flex gap-2">
            <Button onClick={downloadCsv} disabled={!canExport.monthly}>
              CSV mensile
            </Button>
            <Button
              onClick={downloadAbsencesCsv}
              disabled={!canExport.absences}
            >
              CSV assenze
            </Button>
            <Button
              variant="gold"
              onClick={printPdf}
              disabled={!canExport.monthly}
            >
              Stampa / PDF
            </Button>
          </div>
        </div>
      </StickyHeader>

      {/* Prima di esportare: le malattie del periodo senza certificato.
          Avvisa e basta, l'export resta libero. */}
      {certificatesWarning ? (
        <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-t2 print:hidden">
          {certificatesWarning}
        </p>
      ) : null}

      {isError ? <QueryError error={error} /> : null}
      {absenceQuery.isError ? <QueryError error={absenceQuery.error} /> : null}
      {isPending || absenceQuery.isPending ? <TableSkeleton columns={7} label="Caricamento ore…" /> : null}

      {!isPending &&
      !absenceQuery.isPending &&
      !isError &&
      !absenceQuery.isError &&
      people.length === 0 &&
      absences.length === 0 ? (
        <Placeholder
          title={`Nessuna ora registrata in ${label}`}
          detail="Le ore dei turni senza timbratura compaiono automaticamente dopo la fine del turno. Le timbrature richiedono approvazione."
        />
      ) : null}

      {/* Prima del riepilogo: è la cosa da fare. Ogni riga porta al turno, dove
          si inseriscono gli orari, l'uscita o si approva. Fino al 26/10/2026 qui
          c'era solo «N turni da verificare», senza dire quali. */}
      {toFix.length > 0 ? (
        <Card className="mb-4 border-warning/40 bg-warning/5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-t1">{HOURS_TO_FIX_TITLE}</p>
            <p className="text-xs font-semibold text-warning">{hoursToFixSummary(toFix)}</p>
          </div>
          <p className="mt-1 text-xs text-t3">{HOURS_TO_FIX_HINT}</p>
          {regularCount > 0 ? (
            <Button
              variant="gold"
              className="mt-3"
              disabled={approveRegular.isPending}
              onClick={onApproveRegular}
            >
              {approveRegular.isPending ? "Approvo…" : approveRegularLabel(regularCount)}
            </Button>
          ) : null}
          <ul className="mt-3 flex flex-col gap-1">
            {toFixShown.map((item) => (
              <li key={item.assignment_id}>
                <button
                  type="button"
                  onClick={() => navigate(`/planning?shift=${item.shift_id}`)}
                  className="focus-gold flex w-full items-center gap-3 rounded-xl border border-border-2 bg-bg-1 px-3 py-2 text-left transition hover:bg-bg-2"
                >
                  <PersonAvatar personId={item.member_id} name={item.member_name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-t1">{item.member_name}</span>
                    <span className="block truncate text-xs text-t4">
                      {hourToFixWhen(item)}
                      {isMultiVenue ? ` · ${item.venue_name}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-warning">
                    {hourToFixLabel(item)}
                  </span>
                  <span aria-hidden className="text-t4">›</span>
                </button>
              </li>
            ))}
          </ul>
          {toFix.length > TO_FIX_PREVIEW ? (
            <button
              type="button"
              onClick={() => setShowAllToFix((v) => !v)}
              className="focus-gold mt-2 text-xs font-semibold text-gold hover:underline"
            >
              {showAllToFix ? "Mostra meno" : `Mostra tutti (${toFix.length})`}
            </button>
          ) : null}
        </Card>
      ) : null}

      {report.length > 0 && !isPending && !absenceQuery.isPending && !isError && !absenceQuery.isError ? (
        <>
        <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-t3">Ore Lavorate Effettive</p><p className="font-mono text-xl text-t1">{formatHours(totalHours)}</p></div>
          <div><p className="text-xs text-t3">Ore di Assenza Giustificata</p><p className="font-mono text-xl text-t1">{formatHours(totalJustified)}</p></div>
          <div><p className="text-xs text-t3">Totale ore coperte</p><p className="font-mono text-xl text-gold">{formatHours(totalCoveredHours)}</p></div>
          <p className="text-xs text-t4 sm:col-span-3">Senza timbratura, le ore del turno concluso entrano automaticamente e si possono correggere dal turno. Con la timbratura serve che sia approvata. Il totale somma lavoro e assenze riconosciute; non determina la retribuzione.</p>
          {totalConflicts > 0 ? <p className="text-xs text-warning sm:col-span-3">{formatHours(totalConflicts)} di assenza da verificare, escluse dal totale.</p> : null}
          {totalUntracked > 0 ? <p className="text-xs text-warning sm:col-span-3">{formatHours(totalUntracked)} registrate senza timbratura approvata, escluse dalle ore lavorate effettive: le trovi in «{HOURS_TO_FIX_TITLE}».</p> : null}
        </Card>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-2 text-left text-[11px] uppercase tracking-wider text-t3">
                <th className="px-5 py-3 font-semibold">Nome</th>
                <th className="px-5 py-3 font-semibold">Ruolo</th>
                <th className="px-5 py-3 text-right font-semibold">Turni</th>
                <th className="px-5 py-3 text-right font-semibold">Ore Lavorate Effettive</th>
                <th className="px-5 py-3 text-right font-semibold">Ore di Assenza Giustificata</th>
                <th className="px-5 py-3 text-right font-semibold">Totale ore coperte</th>
                <th className="px-5 py-3 text-right font-semibold">Da verificare</th>
              </tr>
            </thead>
            <tbody>
              {report.map((p) => (
                <tr
                  key={p.person_id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-5 py-2.5 text-t1">
                    <span className="flex items-center gap-2">
                      <PersonAvatar personId={p.person_id} name={p.person_name} className="print:hidden" />
                      {p.person_name}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-t3">{p.roles ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-t2">
                    {p.shifts_count}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-t1">
                    {formatHours(p.worked_hours)}
                    {breakSummaryText(p, formatHours) ? (
                      <span className="block font-sans text-[11px] text-t4">
                        {breakSummaryText(p, formatHours)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-t2">{formatHours(p.justified_hours)}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-gold">{formatHours(p.covered_hours)}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-t2">
                    {[
                      p.conflict_hours > 0 ? `${formatHours(p.conflict_hours)} assenza` : null,
                      p.untracked_hours > 0 ? `${formatHours(p.untracked_hours)} senza timbratura` : null,
                      p.to_review_count > 0 ? `${p.to_review_count} timbrature` : null,
                    ].filter(Boolean).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gold/40">
                <td className="px-5 py-3 font-semibold text-t1">Totale</td>
                <td />
                <td className="px-5 py-3 text-right font-mono text-t2">
                  {report.reduce((s, p) => s + p.shifts_count, 0)}
                </td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-gold">
                  {formatHours(totalHours)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-t2">{formatHours(totalJustified)}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-gold">{formatHours(totalCoveredHours)}</td>
                <td className="px-5 py-3 text-right font-mono text-t2">
                  {[
                    totalConflicts > 0 ? `${formatHours(totalConflicts)} assenza` : null,
                    totalUntracked > 0 ? `${formatHours(totalUntracked)} senza timbratura` : null,
                    toReview > 0 ? `${toReview} timbrature` : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
        </>
      ) : null}

      {absences.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-t3">
            Assenze del periodo
          </h2>
          <p className="mb-3 text-xs text-t4">{ABSENCE_SUMMARY_NOTE}</p>
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-2 text-left text-[11px] uppercase tracking-wider text-t3">
                  <th className="px-5 py-3 font-semibold">Nome</th>
                  <th className="px-5 py-3 text-right font-semibold">Ferie (gg)</th>
                  <th className="px-5 py-3 text-right font-semibold">Permessi (gg)</th>
                  <th className="px-5 py-3 text-right font-semibold">Permessi (h)</th>
                  <th className="px-5 py-3 text-right font-semibold">Malattia (gg)</th>
                  <th className="px-5 py-3 font-semibold">
                    Riferimenti certificati medici
                  </th>
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr
                    key={a.person_id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-5 py-2.5 text-t1">
                      <span className="flex items-center gap-2">
                        <PersonAvatar personId={a.person_id} name={a.person_name} className="print:hidden" />
                        {a.person_name}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-t2">
                      {a.ferie_days || "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-t2">
                      {a.permesso_days || "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-t2">
                      {a.permesso_hours ? formatHours(a.permesso_hours) : "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-t2">
                      {a.malattia_days || "—"}
                    </td>
                    <td className="px-5 py-2.5 text-t3">
                      {a.inps_protocols ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}
      {/* Tutto lo storico, non solo il periodo: per chi gestisce l'azienda. */}
      <div className="mt-8 print:hidden"><FullExportCard /></div>
    </>
  );
}
