import { useMemo, useState } from "react";
import { useVenueHoursSummary } from "@/features/assignments/hooks";
import {
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";
import { formatHours } from "@/lib/format";
import { useVenue } from "../lib/venue";
import { monthKey, monthLabel } from "../lib/week";
import {
  Button,
  Card,
  PageHeader,
  Placeholder,
  QueryError,
  Spinner,
} from "../ui/primitives";

/** Ultimi 12 mesi, dal più recente: copre ogni esigenza del commercialista. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1))
  );
}

export function OrePage() {
  const venue = useVenue();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0]);
  const { data, isPending, isError, error } = useVenueHoursSummary(
    venue.id,
    month
  );

  const rows = data ?? [];
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const maxHours = Math.max(1, ...rows.map((r) => r.hours));
  const label = monthLabel(month);

  function downloadCsv() {
    // Stessa funzione pura dell'app: i due file devono coincidere.
    const blob = new Blob([buildHoursCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = hoursFileName(venue.name, label, "csv");
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    // Sul web il PDF lo fa il browser: stesso HTML che l'app manda a expo-print.
    const html = buildHoursHtml(venue.name, label, rows, totalHours);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <>
      <PageHeader
        title="Ore"
        subtitle={`${label} · ${formatHours(totalHours)} totali`}
        actions={
          <>
            <Button onClick={downloadCsv} disabled={rows.length === 0}>
              Esporta CSV
            </Button>
            <Button
              variant="gold"
              onClick={printPdf}
              disabled={rows.length === 0}
            >
              Stampa / PDF
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {months.map((m) => (
          <button
            key={m}
            onClick={() => setMonth(m)}
            className={`focus-gold rounded-full px-3 py-1 text-xs font-medium transition ${
              m === month
                ? "bg-gold text-gold-ink"
                : "border border-border-2 bg-bg-1 text-t2 hover:bg-bg-2"
            }`}
          >
            {monthLabel(m)}
          </button>
        ))}
      </div>

      {isError ? <QueryError error={error} /> : null}
      {isPending ? <Spinner /> : null}

      {!isPending && rows.length === 0 ? (
        <Placeholder
          title={`Nessuna ora registrata a ${label}`}
          detail="Le ore arrivano dai turni interni conclusi. Segna le presenze aprendo un turno passato dal Planning."
        />
      ) : null}

      {rows.length > 0 ? (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-2 text-left text-[11px] uppercase tracking-wider text-t3">
                <th className="px-5 py-3 font-semibold">Nome</th>
                <th className="px-5 py-3 font-semibold">Ruolo</th>
                <th className="px-5 py-3 text-right font-semibold">Turni</th>
                <th className="px-5 py-3 text-right font-semibold">Ore</th>
                <th className="w-1/3 px-5 py-3 font-semibold">Ripartizione</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.staff_member_id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-5 py-2.5 text-t1">{r.display_name}</td>
                  <td className="px-5 py-2.5 text-t3">{r.roles ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-t2">
                    {r.shifts_count}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-t1">
                    {formatHours(r.hours)}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="h-1.5 w-full rounded-full bg-bg-2">
                      <div
                        className="h-1.5 rounded-full bg-gold"
                        style={{ width: `${(r.hours / maxHours) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gold/40">
                <td className="px-5 py-3 font-semibold text-t1">Totale</td>
                <td />
                <td className="px-5 py-3 text-right font-mono text-t2">
                  {rows.reduce((s, r) => s + r.shifts_count, 0)}
                </td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-gold">
                  {formatHours(totalHours)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      ) : null}
    </>
  );
}
