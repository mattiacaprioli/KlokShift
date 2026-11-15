import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/*
 * La timbratura dal telefono: entrata, pausa e uscita del venerdì di Sara, e
 * sotto le ore del mese che si aggiornano da sole. Con `still` (o reduced
 * motion) si vede direttamente la giornata chiusa.
 */

const STEPS = [
  { label: "Entrata", time: "9:58" },
  { label: "Pausa", time: "13:00 – 13:30" },
  { label: "Uscita", time: "19:03" },
];

/** Minuti del mese prima e dopo il venerdì: 61:15 → 69:50. */
const FROM = 61 * 60 + 15;
const TO = 69 * 60 + 50;

const hhmm = (minutes: number) => {
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** Quanto dura il conteggio delle ore, dopo l'uscita. */
const COUNT_MS = 1200;

export function ClockMock({ still = false }: { still?: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const live = !still && !reduce;
  const [done, setDone] = useState(0);
  const [minutes, setMinutes] = useState(FROM);
  const shownDone = live ? done : STEPS.length;
  const shownMinutes = live ? minutes : TO;

  useEffect(() => {
    if (!live) return;
    const timers = STEPS.map((_, i) => setTimeout(() => setDone(i + 1), 450 + i * 550));
    // Il conteggio delle ore, a mano: per un numero che sale non serve il
    // motore di animazione di Motion (che peserebbe sul primo schermo).
    let frame = 0;
    const start = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / COUNT_MS);
        const eased = 1 - (1 - p) ** 3;
        setMinutes(FROM + (TO - FROM) * eased);
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, 450 + STEPS.length * 550);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(start);
      cancelAnimationFrame(frame);
    };
  }, [live]);

  return (
    <div className="px-3 pb-4 text-[0.78rem] leading-tight">
      <p className="px-1 font-serif text-[1.35em] font-semibold">Venerdì 20</p>
      <p className="mt-1 mb-3 px-1 text-t3">Cassa, Sede Centro</p>

      <div className="rounded-2xl border border-border-2 bg-bg-card p-3">
        {STEPS.map((step, i) => {
          const on = i < shownDone;
          return (
            <div
              key={step.label}
              className={`flex items-center justify-between py-1.5 transition-opacity duration-300 ${
                i > 0 ? "border-t border-border" : ""
              } ${on ? "opacity-100" : "opacity-35"}`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full transition-colors duration-300 ${
                    on ? "bg-success" : "border border-border-2"
                  }`}
                />
                {step.label}
              </span>
              <span className="font-semibold tabular-nums">{on ? step.time : "--:--"}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-border-2 bg-bg-card p-3">
        <p className="font-mono text-[0.8em] tracking-wider text-t3 uppercase">
          Le tue ore di novembre
        </p>
        <div className="mt-2 flex items-end justify-between">
          <span className="text-[1.6em] font-bold text-gold tabular-nums">{hhmm(shownMinutes)}</span>
          <span className="text-t3">13 turni svolti</span>
        </div>
      </div>
    </div>
  );
}
