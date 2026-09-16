/*
 * Il riepilogo mensile delle ore: una riga per persona, il totale in fondo e i
 * due export. Nessuna cifra in euro — KlokShift conta ore, non paghe (vedi il
 * commento in cima a `content/it.ts`).
 */

const PEOPLE = [
  { name: "Giulia Rinaldi", role: "Sala", shifts: 18, hours: "96:30" },
  { name: "Marco Tessari", role: "Bar", shifts: 16, hours: "88:00" },
  { name: "Sara Pisani", role: "Sala", shifts: 12, hours: "61:15" },
  { name: "Luca Ferro", role: "Cucina", shifts: 9, hours: "44:45" },
];

export function HoursMock() {
  return (
    <div className="text-[0.72rem] leading-tight sm:text-[0.8rem]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-serif text-[1.3em] font-semibold">
          Ore del mese
        </span>
        <span className="font-mono text-[0.85em] tracking-wider text-t3 uppercase">
          Settembre 2026
        </span>
      </div>

      <div className="p-4">
        <div className="overflow-hidden rounded-xl border border-border">
          {PEOPLE.map((person, i) => (
            <div
              key={person.name}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-2 font-mono text-[0.8em] text-t2">
                {person.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {person.name}
              </span>
              <span className="hidden shrink-0 text-t3 sm:inline">
                {person.role}
              </span>
              <span className="shrink-0 text-t3 tabular-nums">
                {person.shifts} turni
              </span>
              <span className="w-14 shrink-0 text-right font-semibold tabular-nums">
                {person.hours}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 border-t border-border-2 bg-bg-card px-3 py-2.5">
            <span className="flex-1 font-mono text-[0.85em] tracking-wider text-t3 uppercase">
              Totale mese
            </span>
            <span className="text-[1.1em] font-bold text-gold tabular-nums">
              290:30
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <span className="rounded-full border border-border-2 px-3 py-1.5 text-t2">
            Esporta PDF
          </span>
          <span className="rounded-full border border-border-2 px-3 py-1.5 text-t2">
            Esporta CSV
          </span>
        </div>
      </div>
    </div>
  );
}
