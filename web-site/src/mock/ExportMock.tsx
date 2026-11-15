/*
 * L'ultimo passo della storia: il file per il consulente, una riga per
 * persona, giorno e voce (come l'export giornaliero della pagina Ore). Solo
 * ore, mai importi.
 */

const ROWS = [
  { code: "0012", name: "Rinaldi Giulia", day: "16/11", kind: "Lavoro", hours: "8,00" },
  { code: "0012", name: "Rinaldi Giulia", day: "17/11", kind: "Lavoro", hours: "8,00" },
  { code: "0019", name: "Tessari Marco", day: "17/11", kind: "Lavoro", hours: "7,50" },
  { code: "0027", name: "Pisani Sara", day: "20/11", kind: "Lavoro", hours: "8,50" },
  { code: "0031", name: "Ferro Luca", day: "21/11", kind: "Ferie", hours: "6,00" },
];

export function ExportMock() {
  return (
    <div className="text-[0.72rem] leading-tight sm:text-[0.8rem]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="rounded-md bg-success/15 px-1.5 py-0.5 font-mono text-[0.8em] font-semibold text-success">
            CSV
          </span>
          <span className="font-semibold">ore-novembre-2026.csv</span>
        </span>
        <span className="text-t3">pronto</span>
      </div>

      <div className="overflow-hidden p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_3.25rem_2.5rem] gap-x-2 font-mono text-[0.9em] sm:grid-cols-[3rem_minmax(0,1fr)_3rem_4rem_3rem] sm:gap-x-3">
          {/* Sul telefono la matricola resta fuori: le colonne non ci stanno. */}
          {["Matr.", "Persona", "Giorno", "Voce", "Ore"].map((head, i) => (
            <span
              key={head}
              className={`border-b border-border pb-2 text-t3 ${i === 0 ? "hidden sm:block" : ""} ${i === 4 ? "text-right" : ""}`}
            >
              {head}
            </span>
          ))}
          {ROWS.map((row) => (
            <Row key={`${row.code}-${row.day}`} row={row} />
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <span className="rounded-full bg-gold px-3 py-1.5 font-semibold text-gold-ink">Scarica CSV</span>
          <span className="rounded-full border border-border-2 px-3 py-1.5 text-t2">Scarica PDF</span>
        </div>
      </div>
    </div>
  );
}

function Row({ row }: { row: (typeof ROWS)[number] }) {
  return (
    <>
      <span className="hidden py-1.5 text-t3 sm:block">{row.code}</span>
      <span className="truncate py-1.5 text-t1">{row.name}</span>
      <span className="py-1.5 text-t2">{row.day}</span>
      <span className={`py-1.5 ${row.kind === "Ferie" ? "text-info" : "text-t2"}`}>{row.kind}</span>
      <span className="py-1.5 text-right text-t1 tabular-nums">{row.hours}</span>
    </>
  );
}
