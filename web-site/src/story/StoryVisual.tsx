import { useEffect, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { WeekBoard } from "../mock/WeekBoard";
import { ConfirmMock } from "../mock/ConfirmMock";
import { ClockMock } from "../mock/ClockMock";
import { HoursMock } from "../mock/HoursMock";
import { ExportMock } from "../mock/ExportMock";
import { WEEK_SHIFTS, draftWeek } from "../mock/week";
import { cn } from "../ui/cn";
import { visualMode } from "./progress";

/*
 * L'oggetto della storia: una sola cornice che cambia forma — la finestra
 * della settimana, poi il telefono di Sara, poi di nuovo la finestra con le ore
 * che diventano il file per il consulente. La cornice è un layout di Motion,
 * quindi il passaggio fra le forme è un morph continuo e non un cambio di
 * immagine; il contenuto sfuma dentro.
 *
 * `step` è -1 finché la storia non arriva al centro dello schermo: si vede il
 * primo passo, fermo, e i suoi momenti partono solo quando ci si arriva. Con
 * `still` (i passi in colonna sul telefono) o con reduced motion ogni passo
 * mostra subito il suo stato finale, senza timer né dissolvenze.
 *
 * È decorativo per chi legge con lo schermo: il testo del passo dice già tutto.
 */

type FrameKind = "desktop" | "phone";
type Mode = ReturnType<typeof visualMode>;
const FRAMES: FrameKind[] = ["desktop", "phone", "phone", "desktop"];
const EASE = [0.22, 1, 0.36, 1] as const;

/** Quanto resta in bozza la settimana prima di essere pubblicata. */
const PUBLISH_MS = 1300;
/** Quando il turno di Sara riceve la risposta. */
const CONFIRM_MS = 1400;
/** Quando le ore del mese diventano il file. */
const EXPORT_MS = 900;

export function StoryVisual({ step, still = false }: { step: number; still?: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const mode = visualMode({ still, reduce, started: step >= 0 });
  const shown = Math.max(step, 0);
  const frame = FRAMES[shown] ?? "desktop";
  const phone = frame === "phone";

  return (
    <m.div
      aria-hidden="true"
      layout
      transition={{ layout: { duration: 0.7, ease: EASE } }}
      style={{ borderRadius: phone ? 32 : 16 }}
      className={cn(
        "relative mx-auto w-full overflow-hidden border border-border-2 bg-bg-card shadow-2xl shadow-black/50",
        phone ? "max-w-[19rem] p-2" : "max-w-3xl"
      )}
    >
      <m.div layout="position" className={cn(phone && "absolute top-2.5 left-1/2 -translate-x-1/2")}>
        {phone ? (
          <span className="block h-1.5 w-20 rounded-full bg-bg-3" />
        ) : (
          <span className="flex items-center gap-1.5 border-b border-border px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
            <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
            <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
          </span>
        )}
      </m.div>

      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={shown}
          layout
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: reduce ? { duration: 0 } : { duration: 0.35, delay: 0.2 } }}
          exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.15 } }}
          className={cn("bg-bg-0", phone && "overflow-hidden rounded-[1.6rem] pt-6")}
        >
          <StepContent step={shown} mode={mode} />
        </m.div>
      </AnimatePresence>
    </m.div>
  );
}

function StepContent({ step, mode }: { step: number; mode: Mode }) {
  if (step === 0) return <Publish mode={mode} />;
  if (step === 1) return <Confirm mode={mode} />;
  if (step === 2) return <ClockMock still={mode === "final"} />;
  return <Export mode={mode} />;
}

/** Diventa vero `ms` dopo che il passo si anima; subito in `final`, mai in `paused`. */
function useAfter(ms: number, mode: Mode) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (mode !== "live") return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms, mode]);
  return mode === "final" || (mode === "live" && elapsed);
}

function Publish({ mode }: { mode: Mode }) {
  const published = useAfter(PUBLISH_MS, mode);
  return (
    <div className="relative pb-4">
      <WeekBoard
        bare
        label=""
        shifts={published ? WEEK_SHIFTS : draftWeek(WEEK_SHIFTS)}
      />
      <div className="mx-4 flex items-center justify-between rounded-xl border border-border-2 bg-bg-card px-3 py-2 text-[0.78rem]">
        <span className="text-t2">
          {published ? "Pubblicata: 5 persone avvisate" : "Bozza, il team non la vede"}
        </span>
        <span
          className={cn(
            "rounded-full px-3 py-1 font-semibold transition-colors duration-500",
            published ? "bg-success/15 text-success" : "bg-gold text-gold-ink"
          )}
        >
          {published ? "Pubblicata" : "Pubblica"}
        </span>
      </div>
    </div>
  );
}

function Confirm({ mode }: { mode: Mode }) {
  const confirmed = useAfter(CONFIRM_MS, mode);
  return <ConfirmMock confirmed={confirmed} />;
}

function Export({ mode }: { mode: Mode }) {
  const ready = useAfter(EXPORT_MS, mode);
  return (
    <div className="relative min-h-[22rem]">
      <div className={cn("transition-opacity duration-500", ready && "opacity-40")}>
        <HoursMock highlight="SP" />
      </div>
      <m.div
        initial={false}
        animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
        transition={mode === "final" ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        className="absolute inset-x-6 bottom-4 overflow-hidden rounded-xl border border-border-gold bg-bg-card shadow-2xl shadow-black/60"
      >
        <ExportMock />
      </m.div>
    </div>
  );
}
