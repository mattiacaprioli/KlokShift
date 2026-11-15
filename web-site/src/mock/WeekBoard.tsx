import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Shot } from "./Shot";
import { cn } from "../ui/cn";
import { WEEK_DAYS, WEEK_PEOPLE, type WeekShift } from "./week";

/*
 * La settimana dei turni, vista per persona come nella dashboard: è l'oggetto
 * attorno a cui gira tutta la home (apertura, storia, chiusura).
 *
 * Con `intro` i turni cadono al loro posto **una volta sola**, poi si accendono
 * le conferme e, qualche secondo dopo, l'ultima persona conferma con il suo
 * avviso. Nessun loop: dopo, la settimana resta ferma e il solo movimento è il
 * buco del sabato che pulsa piano per qualche giro. Con reduced motion si vede
 * subito lo stato finale.
 *
 * Sotto `sm` la settimana intera non ci sta: si vedono tre giorni a partire da
 * `mobileFrom` (di default venerdì, dove sono la conferma attesa e il buco), e
 * la pagina non scorre mai in orizzontale.
 *
 * Le scritte dentro (Turni, Settimana, Da coprire) imitano l'interfaccia e sono
 * nascoste agli screen reader, come negli altri mock: il testo vero lo dà
 * `label`, dal copy.
 */

const MOBILE_DAYS = 3;
const EASE = [0.22, 1, 0.36, 1] as const;

/** Quando l'ultima persona conferma, a intro partito. */
const SETTLE_MS = 4200;
/** Quanto resta l'avviso della conferma. */
const TOAST_MS = 4500;

export function WeekBoard({
  shifts,
  label,
  intro = false,
  tilt = false,
  toast,
  mobileFrom = 4,
  bare = false,
  className,
}: {
  shifts: readonly WeekShift[];
  label: string;
  intro?: boolean;
  tilt?: boolean;
  toast?: string;
  mobileFrom?: number;
  /** Senza la cornice della finestra: la mette chi la ospita (la storia). */
  bare?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const animate = intro && !reduce;
  const [settledByTimer, setSettled] = useState(false);
  const [toastOn, setToastOn] = useState(false);
  // Senza animazione (reduced motion) l'ultima conferma è già arrivata.
  const settled = settledByTimer || !animate;

  useEffect(() => {
    if (!animate) return;
    const settle = setTimeout(() => {
      setSettled(true);
      setToastOn(true);
    }, SETTLE_MS);
    const hide = setTimeout(() => setToastOn(false), SETTLE_MS + TOAST_MS);
    return () => {
      clearTimeout(settle);
      clearTimeout(hide);
    };
  }, [animate]);

  const shown = shifts.map((shift) =>
    intro && settled && shift.state === "pending"
      ? { ...shift, state: "confirmed" as const }
      : shift
  );
  const hasOpen = shown.some((shift) => shift.person === -1);
  const rows = [
    ...WEEK_PEOPLE.map((person, i) => ({ key: i, name: person.name, initials: person.initials, tone: person.tone })),
    ...(hasOpen ? [{ key: -1, name: "Da coprire", initials: "", tone: "" }] : []),
  ];
  const isMobileDay = (day: number) => day >= mobileFrom && day < mobileFrom + MOBILE_DAYS;

  return (
    <div className={cn("relative", tilt && "xl:[perspective:1600px]", className)}>
      <div
        className={cn(
          tilt &&
            "xl:[transform:rotateY(-8deg)_rotateX(4deg)] xl:shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)]"
        )}
      >
        <Frame bare={bare} label={label}>
          <div className="text-[0.72rem] leading-tight sm:text-[0.78rem]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-serif text-[1.3em] font-semibold">Turni</span>
              <div className="flex gap-1.5">
                <span className="rounded-full bg-gold px-2.5 py-1 text-[0.85em] font-medium text-gold-ink">
                  Settimana
                </span>
                <span className="rounded-full border border-border-2 px-2.5 py-1 text-[0.85em] text-t2">
                  Persone
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[5.5rem_repeat(3,minmax(0,1fr))] gap-1.5 p-3 sm:grid-cols-[7.25rem_repeat(7,minmax(0,1fr))] lg:grid-cols-[6rem_repeat(7,minmax(0,1fr))] xl:grid-cols-[7.25rem_repeat(7,minmax(0,1fr))] sm:p-4">
              <span />
              {WEEK_DAYS.map((day, d) => (
                <span
                  key={day}
                  className={cn(
                    "pb-1 text-center text-[0.85em] text-t3",
                    !isMobileDay(d) && "hidden sm:block"
                  )}
                >
                  {day}
                </span>
              ))}

              {rows.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  shifts={shown.filter((shift) => shift.person === row.key)}
                  isMobileDay={isMobileDay}
                  animate={animate}
                />
              ))}
            </div>
          </div>
        </Frame>
      </div>

      <AnimatePresence>
        {toast && toastOn && (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="absolute right-3 -bottom-5 flex items-center gap-2.5 rounded-xl border border-border-2 bg-bg-2 px-3.5 py-2.5 text-sm shadow-2xl shadow-black/60 sm:right-6"
          >
            <span className="h-2 w-2 rounded-full bg-success" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Frame({ bare, label, children }: { bare: boolean; label: string; children: ReactNode }) {
  if (!bare) {
    return (
      <Shot kind="desktop" alt={label}>
        {children}
      </Shot>
    );
  }
  return (
    <div title={label} aria-hidden="true">
      {children}
    </div>
  );
}

function Row({
  row,
  shifts,
  isMobileDay,
  animate,
}: {
  row: { key: number; name: string; initials: string; tone: string };
  shifts: WeekShift[];
  isMobileDay: (day: number) => boolean;
  animate: boolean;
}) {
  const open = row.key === -1;
  return (
    <>
      <div className="flex min-h-11 items-center gap-2 rounded-lg bg-bg-card px-2 py-1.5">
        {open ? (
          <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-error/70" />
        ) : (
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7em] font-bold text-gold-ink",
              row.tone
            )}
          >
            {row.initials}
          </span>
        )}
        <span className={cn("truncate font-semibold", open && "text-error/90")}>{row.name}</span>
      </div>
      {WEEK_DAYS.map((day, d) => {
        const shift = shifts.find((s) => s.day === d);
        return (
          <div
            key={day}
            className={cn(
              "min-h-11 rounded-lg border border-dashed border-border p-0.5",
              !isMobileDay(d) && "hidden sm:block"
            )}
          >
            {shift && <Block shift={shift} animate={animate} />}
          </div>
        );
      })}
    </>
  );
}

function Block({ shift, animate }: { shift: WeekShift; animate: boolean }) {
  const person = Math.max(shift.person, 0);
  const delay = 0.15 + person * 0.12 + shift.day * 0.06;
  const isOpen = shift.state === "open";

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: -12, scale: 0.96 } : false}
      animate={
        animate && isOpen
          ? { opacity: [1, 0.55, 1], y: 0, scale: 1 }
          : { opacity: 1, y: 0, scale: 1 }
      }
      transition={
        animate && isOpen
          ? { opacity: { delay: delay + 1.2, duration: 2.4, repeat: 4, ease: "easeInOut" }, default: { delay, duration: 0.45, ease: EASE } }
          : { delay, duration: 0.45, ease: EASE }
      }
      className={cn(
        "relative h-full rounded-md py-1.5 pr-2.5 pl-1.5 transition-colors duration-500",
        shift.state === "confirmed" && "border-l-2 border-l-success bg-bg-card",
        shift.state === "pending" && "border-l-2 border-l-gold bg-gold/10",
        shift.state === "open" && "border border-dashed border-error/70 bg-error/5 text-error/90",
        shift.state === "draft" && "border border-dashed border-border-2 text-t3"
      )}
    >
      <p className="font-semibold whitespace-nowrap tabular-nums">{shift.time}</p>
      <p className={cn("truncate text-[0.85em]", isOpen ? "text-error/70" : "text-t3")}>{shift.role}</p>
      {(shift.state === "confirmed" || shift.state === "pending") && (
        <motion.span
          initial={animate ? { opacity: 0, scale: 0.3 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: animate ? delay + 0.9 : 0, duration: 0.3 }}
          className={cn(
            "absolute top-1 right-1 h-1.5 w-1.5 rounded-full",
            shift.state === "confirmed" ? "bg-success" : "border border-gold"
          )}
        />
      )}
    </motion.div>
  );
}
