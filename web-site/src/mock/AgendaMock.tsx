/*
 * L'agenda della sede, ricostruita: striscia della settimana + turni del giorno
 * raggruppati sotto la data. La card ricalca `ManagerShiftCard` dell'app —
 * barra della copertura a sinistra (verde coperto, arancio manca qualcuno),
 * orario in evidenza, ruoli sotto — perché un mockup che promette un'altra
 * interfaccia è una bugia che si scopre al primo accesso.
 *
 * Tutto in `em`: la cornice di `Shot` fissa la taglia, qui dentro si scala.
 */

const DAYS = [
  { d: "L", n: 15 },
  { d: "M", n: 16 },
  { d: "M", n: 17, active: true },
  { d: "G", n: 18 },
  { d: "V", n: 19, dot: true },
  { d: "S", n: 20, dot: true },
  { d: "D", n: 21 },
];

export function AgendaMock() {
  return (
    <div className="px-3 pb-4 text-[0.78rem] leading-tight">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <span className="font-serif text-[1.35em] font-semibold">Turni</span>
        <span className="font-mono text-[0.85em] tracking-wider text-t3 uppercase">
          Settembre
        </span>
      </div>

      <div className="flex justify-between gap-1 rounded-2xl border border-border bg-bg-card p-2">
        {DAYS.map((day, i) => (
          <div
            key={i}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 ${
              day.active ? "bg-gold text-gold-ink" : "text-t2"
            }`}
          >
            <span className="font-mono text-[0.8em] opacity-70">{day.d}</span>
            <span className="text-[1.05em] font-semibold">{day.n}</span>
            <span
              className={`h-1 w-1 rounded-full ${
                day.dot ? "bg-warning" : "bg-transparent"
              }`}
            />
          </div>
        ))}
      </div>

      <p className="mt-4 mb-2 px-1 font-mono text-[0.8em] tracking-wider text-t3 uppercase">
        Mercoledì 17
      </p>

      <ShiftRow
        tone="covered"
        start="11:30"
        end="15:00"
        label="Pranzo"
        meta="3/3 coperti"
        roles={[
          { name: "Sala", value: "2/2" },
          { name: "Bar", value: "1/1" },
        ]}
      />
      <ShiftRow
        tone="short"
        start="18:00"
        end="23:30"
        label="Cena"
        meta="manca 1"
        roles={[
          { name: "Sala", value: "3/3" },
          { name: "Runner", value: "0/1", short: true },
        ]}
      />
    </div>
  );
}

function ShiftRow({
  tone,
  start,
  end,
  label,
  meta,
  roles,
}: {
  tone: "covered" | "short";
  start: string;
  end: string;
  label: string;
  meta: string;
  roles: { name: string; value: string; short?: boolean }[];
}) {
  return (
    <div className="mb-2 flex gap-3 rounded-2xl border border-border-2 bg-bg-card p-3">
      <span
        className={`w-1 shrink-0 rounded-full ${
          tone === "covered" ? "bg-success" : "bg-warning"
        }`}
      />
      <div className="shrink-0 pt-0.5">
        <p className="text-[1.15em] font-bold tabular-nums">{start}</p>
        <p className="text-[0.9em] text-t3 tabular-nums">{end}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{label}</p>
        <p
          className={`text-[0.9em] ${
            tone === "short" ? "font-semibold text-warning" : "text-t2"
          }`}
        >
          {meta}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <span
              key={role.name}
              className={`rounded-full border px-2 py-0.5 text-[0.8em] ${
                role.short
                  ? "border-warning/40 text-warning"
                  : "border-border-2 text-t2"
              }`}
            >
              {role.name} {role.value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
