import { PersonAvatar } from "../ui/PersonAvatar";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { companyName } from "@/features/venues/companyName";
import { useOwnerHoursSummary } from "@/features/assignments/hooks";
import { groupHoursByPerson } from "@/features/assignments/hoursSummary";
import { exportAvailability, monthlyReportRows } from "@/features/assignments/monthlyReport";
import { useOwnerAbsenceSummary } from "@/features/absences/hooks";
import { ABSENCE_SUMMARY_NOTE } from "@/features/absences/summary";
import {
  absencesFileName,
  buildAbsencesCsv,
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";
import { formatHours } from "@/lib/format";
import { monthKey, monthLabel } from "../lib/week";
import {
  Button,
  Card,
  PageHeader,
  Placeholder,
  QueryError,
  Select,
  Spinner,
  StickyHeader,
} from "../ui/primitives";

/** Ultimi 12 mesi, dal più recente: copre ogni esigenza del commercialista. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1))
  );
}

/**
 * Le ore del mese di **tutta l'azienda**, una riga per persona.
 *
 * Nessun selettore di sede e nessuno split: chi lavora in due sedi dello stesso
 * titolare ha **una** busta paga, e il numero che serve è il totale. Fino al
 * 14/09/2026 ogni riga si apriva sul dettaglio per sede; è stato tolto perché
 * rispondeva a una domanda che questa pagina non fa — esiste per pagare le
 * persone, non per allocare il costo fra le sedi.
 */
export function OrePage() {
  const { profile } = useAuth();
  const { workspaceId, venues } = useOwnerVenues();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);
  // `months` va dal più recente: +1 è il mese prima.
  const monthIndex = months.indexOf(month);
  const { data, isPending, isError, error } = useOwnerHoursSummary(
    workspaceId,
    month
  );

  const rows = data ?? [];
  // La RPC torna righe (persona × sede); questa le somma per persona, ed è
  // quello che si mostra. Lo split resta nei dati (serve a comporre i ruoli) e
  // non arriva in pagina.
  const people = groupHoursByPerson(rows);
  const totalHours = people.reduce((s, p) => s + p.hours, 0);
  const toReview = people.reduce((s, p) => s + p.to_review_count, 0);
  const proposedHours = people.reduce((s, p) => s + p.proposed_hours, 0);
  const label = monthLabel(month);
  const company = companyName(venues, profile?.full_name);
  // Ferie, permessi e malattia del mese: ore nel consuntivo, giorni nel dettaglio.
  const absenceQuery = useOwnerAbsenceSummary(workspaceId, month);
  const absences = absenceQuery.data ?? [];
  const report = monthlyReportRows(people, absences);
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
    download(buildHoursCsv(people, absences), hoursFileName(company, label, "csv"));
  }

  function downloadAbsencesCsv() {
    if (!canExport.absences) return;
    download(
      buildAbsencesCsv(absences),
      absencesFileName(company, label, "csv")
    );
  }

  function printPdf() {
    if (!canExport.monthly) return;
    // Sul web il PDF lo fa il browser: stesso HTML che l'app manda a expo-print.
    const html = buildHoursHtml(company, label, people, totalHours, absences);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <>
      <StickyHeader>
        <PageHeader
          title="Ore"
          subtitle={`${label} · ${formatHours(totalHours)} lavorate effettive${toReview > 0 ? ` · ${toReview} turni da verificare` : ""}`}
        />

        {/* Una riga sotto il titolo, come i filtri dello Storico. Niente
            `items-center`: lo stretch dà a frecce, tendina e bottoni la stessa
            altezza anche se il glifo della freccia è più alto del testo. */}
        <div className="mb-5 flex flex-wrap justify-between gap-3 print:hidden">
          {/* Frecce per il mese accanto (il caso di tutti i mesi: chiudere il
              precedente), tendina per saltare. Le pillole andavano a capo. */}
          <div className="flex gap-2">
            <Button
              aria-label="Mese precedente"
              onClick={() => setMonth(months[monthIndex + 1])}
              disabled={monthIndex === months.length - 1}
            >
              ←
            </Button>
            <Select
              aria-label="Mese"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-auto"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
            <Button
              aria-label="Mese successivo"
              onClick={() => setMonth(months[monthIndex - 1])}
              disabled={monthIndex === 0}
            >
              →
            </Button>
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

      {isError ? <QueryError error={error} /> : null}
      {absenceQuery.isError ? <QueryError error={absenceQuery.error} /> : null}
      {isPending || absenceQuery.isPending ? <Spinner /> : null}

      {!isPending &&
      !absenceQuery.isPending &&
      !isError &&
      !absenceQuery.isError &&
      people.length === 0 &&
      absences.length === 0 ? (
        <Placeholder
          title={`Nessuna ora registrata a ${label}`}
          detail="Le ore dei turni senza timbratura compaiono automaticamente dopo la fine del turno. Le timbrature richiedono approvazione."
        />
      ) : null}

      {report.length > 0 && !isPending && !absenceQuery.isPending && !isError && !absenceQuery.isError ? (
        <>
        {toReview > 0 ? (
          <Card className="mb-4 border-gold/40 bg-gold/5">
            <p className="text-sm font-semibold text-t1">
              {toReview} {toReview === 1 ? "turno da verificare" : "turni da verificare"}
            </p>
            <p className="mt-1 text-xs text-t3">
              Le timbrature complete propongono {formatHours(proposedHours)}. Non entrano nel totale finché non vengono approvate dal dettaglio del turno.
            </p>
          </Card>
        ) : null}
        <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-t3">Ore Lavorate Effettive</p><p className="font-mono text-xl text-t1">{formatHours(totalHours)}</p></div>
          <div><p className="text-xs text-t3">Ore di Assenza Giustificata</p><p className="font-mono text-xl text-t1">{formatHours(totalJustified)}</p></div>
          <div><p className="text-xs text-t3">Totale ore coperte</p><p className="font-mono text-xl text-gold">{formatHours(totalCoveredHours)}</p></div>
          <p className="text-xs text-t4 sm:col-span-3">Senza timbratura, le ore del turno concluso entrano automaticamente e si possono correggere dal turno. Con la timbratura serve che sia approvata. Il totale somma lavoro e assenze riconosciute; non determina la retribuzione.</p>
          {totalConflicts > 0 ? <p className="text-xs text-warning sm:col-span-3">{formatHours(totalConflicts)} di assenza da verificare, escluse dal totale.</p> : null}
          {totalUntracked > 0 ? <p className="text-xs text-warning sm:col-span-3">{formatHours(totalUntracked)} registrate senza timbratura approvata, escluse dalle ore lavorate effettive.</p> : null}
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
            Assenze del mese
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
    </>
  );
}
