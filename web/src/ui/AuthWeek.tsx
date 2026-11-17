import { cn } from "@/lib/cn";

/*
 * La settimana del sito vetrina, in piccolo, accanto alla registrazione: chi
 * arriva dal sito ritrova lo stesso oggetto. È arredo (aria-hidden): il testo
 * vero sta nel titolo e nei tre punti sotto.
 *
 * Niente Motion sulla dashboard (test `motionScope`): i turni entrano una volta
 * sola con un'animazione CSS (`auth-week-in` in index.css), e con reduced
 * motion sono già al loro posto. Dati finti di un'azienda qualunque a turni,
 * non solo un ristorante.
 */

type State = "confirmed" | "pending" | "open";

const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven"];

const PEOPLE = [
  { name: "Giulia R.", initials: "GR", tone: "bg-gold-fill" },
  { name: "Marco T.", initials: "MT", tone: "bg-[#9ec7a8]" },
  { name: "Sara P.", initials: "SP", tone: "bg-[#c9a7e0]" },
  { name: "Anna B.", initials: "AB", tone: "bg-[#8fb6e8]" },
];

/** [persona, giorno, orario, ruolo, stato]; persona -1 = «Da coprire». */
const SHIFTS: [number, number, string, string, State][] = [
  [0, 0, "7–15", "Reception", "confirmed"],
  [0, 1, "7–15", "Reception", "confirmed"],
  [0, 3, "15–23", "Reception", "confirmed"],
  [0, 4, "15–23", "Reception", "confirmed"],
  [1, 1, "9–17", "Magazzino", "confirmed"],
  [1, 2, "9–17", "Magazzino", "confirmed"],
  [1, 3, "9–17", "Magazzino", "confirmed"],
  [2, 0, "10–19", "Cassa", "confirmed"],
  [2, 2, "10–19", "Cassa", "confirmed"],
  [2, 4, "10–19", "Cassa", "pending"],
  [3, 0, "6–12", "Pulizie", "confirmed"],
  [3, 1, "6–12", "Pulizie", "confirmed"],
  [3, 3, "6–12", "Pulizie", "confirmed"],
  [-1, 4, "18–24", "Sala", "open"],
];

export function AuthWeek() {
  const rows = [...PEOPLE.map((p, i) => ({ key: i, ...p })), { key: -1, name: "Da coprire", initials: "", tone: "" }];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-border-2 bg-bg-0/80 text-[0.72rem] leading-tight shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-serif text-[1.25em] font-semibold text-t1">Turni</span>
        <span className="rounded-full bg-gold-fill px-2.5 py-1 text-[0.85em] font-medium text-gold-ink">Settimana</span>
      </div>
      <div className="grid grid-cols-[7.25rem_repeat(5,minmax(0,1fr))] gap-1.5 p-3">
        <span />
        {DAYS.map((day) => (
          <span key={day} className="pb-1 text-center text-[0.85em] text-t3">
            {day}
          </span>
        ))}
        {rows.map((row) => (
          <Row key={row.key} name={row.name} initials={row.initials} tone={row.tone} person={row.key} />
        ))}
      </div>
    </div>
  );
}

function Row({
  name,
  initials,
  tone,
  person,
}: {
  name: string;
  initials: string;
  tone: string;
  person: number;
}) {
  const open = person === -1;
  return (
    <>
      <div className="flex min-h-10 items-center gap-2 rounded-lg bg-bg-card px-2 py-1.5">
        {open ? (
          <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-error/70" />
        ) : (
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7em] font-bold text-gold-ink",
              tone
            )}
          >
            {initials}
          </span>
        )}
        <span className={cn("truncate font-semibold", open ? "text-error/90" : "text-t1")}>{name}</span>
      </div>
      {DAYS.map((day, d) => {
        const shift = SHIFTS.find(([p, sd]) => p === person && sd === d);
        return (
          <div key={day} className="min-h-10 rounded-lg border border-dashed border-border p-0.5">
            {shift ? <Block shift={shift} /> : null}
          </div>
        );
      })}
    </>
  );
}

function Block({ shift: [person, day, time, role, state] }: { shift: (typeof SHIFTS)[number] }) {
  // Cadono riga dopo riga, come sul sito; il buco arriva per ultimo.
  const row = person < 0 ? PEOPLE.length : person;
  const delay = 0.2 + row * 0.1 + day * 0.05;
  return (
    <div
      style={{ animationDelay: `${delay}s` }}
      className={cn(
        "auth-week-in relative h-full rounded-md py-1.5 pr-2.5 pl-1.5",
        state === "confirmed" && "border-l-2 border-l-success bg-bg-card text-t1",
        state === "pending" && "border-l-2 border-l-gold bg-gold/10 text-t1",
        state === "open" && "auth-week-open border border-dashed border-error/70 bg-error/5 text-error/90"
      )}
    >
      <p className="font-semibold whitespace-nowrap tabular-nums">{time}</p>
      <p className={cn("truncate text-[0.85em]", state === "open" ? "text-error/70" : "text-t3")}>{role}</p>
      {state !== "open" ? (
        <span
          className={cn(
            "absolute top-1 right-1 h-1.5 w-1.5 rounded-full",
            state === "confirmed" ? "bg-success" : "border border-gold"
          )}
        />
      ) : null}
    </div>
  );
}
