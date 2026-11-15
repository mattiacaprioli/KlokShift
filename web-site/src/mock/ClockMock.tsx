import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

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

const hhmm = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

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
    const counter = animate(FROM, TO, {
      delay: 0.45 + STEPS.length * 0.55,
      duration: 1.2,
      ease: "easeOut",
      onUpdate: setMinutes,
    });
    return () => {
      timers.forEach(clearTimeout);
      counter.stop();
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
