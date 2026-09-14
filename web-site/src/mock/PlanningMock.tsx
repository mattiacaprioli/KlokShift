/*
 * Il planning settimanale della dashboard: una riga per persona, una colonna
 * per giorno, i turni come blocchi col bordo della copertura.
 *
 * È il mockup più largo del sito, quindi è anche quello che romperebbe il
 * telefono: la griglia ha una larghezza minima e scorre **dentro** il proprio
 * contenitore (`overflow-x-auto`), così su 375px se ne vedono tre giorni e la
 * pagina non scorre mai in orizzontale.
 */

const DAYS = ["Lun 15", "Mar 16", "Mer 17", "Gio 18", "Ven 19", "Sab 20"];

type Block = { day: number; time: string; role: string; tone?: "short" };

const ROWS: { name: string; role: string; blocks: Block[] }[] = [
  {
    name: "Giulia R.",
    role: "Sala",
    blocks: [
      { day: 0, time: "18–23", role: "Sala" },
      { day: 2, time: "11–15", role: "Sala" },
      { day: 4, time: "18–24", role: "Sala" },
    ],
  },
  {
    name: "Marco T.",
    role: "Bar",
    blocks: [
      { day: 1, time: "18–24", role: "Bar" },
      { day: 4, time: "18–24", role: "Bar" },
      { day: 5, time: "19–01", role: "Bar" },
    ],
  },
  {
    name: "Sara P.",
    role: "Sala",
    blocks: [
      { day: 2, time: "18–23", role: "Sala" },
      { day: 3, time: "11–15", role: "Sala" },
    ],
  },
  {
    name: "Da coprire",
    role: "Runner",
    blocks: [{ day: 5, time: "19–01", role: "Runner", tone: "short" }],
  },
];

export function PlanningMock() {
  return (
    <div className="text-[0.72rem] leading-tight sm:text-[0.8rem]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-serif text-[1.3em] font-semibold">Planning</span>
        <div className="flex gap-1.5">
          <span className="rounded-full bg-gold px-2.5 py-1 text-[0.85em] font-medium text-gold-ink">
            Settimana
          </span>
          <span className="rounded-full border border-border-2 px-2.5 py-1 text-[0.85em] text-t2">
            Mese
          </span>
          <span className="rounded-full border border-border-2 px-2.5 py-1 text-[0.85em] text-t2">
            Persone
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[44rem] p-4">
          <div className="grid grid-cols-[7rem_repeat(6,1fr)] gap-1.5">
            <span />
            {DAYS.map((day) => (
              <span
                key={day}
                className="pb-1 text-center font-mono text-[0.85em] tracking-wider text-t3 uppercase"
              >
                {day}
              </span>
            ))}

            {ROWS.map((row) => (
              <Row key={row.name} row={row} />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-t3">
            <Legend tone="bg-success" label="coperto" />
            <Legend tone="bg-warning" label="mancano persone" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ row }: { row: (typeof ROWS)[number] }) {
  return (
    <>
      <div className="flex min-h-12 flex-col justify-center rounded-lg bg-bg-card px-2.5 py-1.5">
        <span className="truncate font-semibold">{row.name}</span>
        <span className="truncate text-[0.85em] text-t3">{row.role}</span>
      </div>
      {DAYS.map((day, i) => {
        const block = row.blocks.find((b) => b.day === i);
        return (
          <div
            key={day}
            className="min-h-12 rounded-lg border border-dashed border-border p-1"
          >
            {block && (
              <div
                className={`h-full rounded-md border-l-2 bg-bg-card px-2 py-1.5 ${
                  block.tone === "short"
                    ? "border-l-warning"
                    : "border-l-success"
                }`}
              >
                <p className="font-semibold tabular-nums">{block.time}</p>
                <p className="truncate text-[0.85em] text-t3">{block.role}</p>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      {label}
    </span>
  );
}
