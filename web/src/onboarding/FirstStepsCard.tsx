import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useFirstSteps } from "@/features/onboarding/useFirstSteps";
import type { FirstStepId, FirstStepsMemory } from "@/features/onboarding/firstSteps";
import { cn } from "@/lib/cn";
import { loadFirstStepsMemory, saveFirstStepsMemory } from "./firstStepsStorage";

const ROUTES: Record<FirstStepId, string> = {
  trial: "/prova",
  roles: "/ruoli",
  people: "/staff?aggiungi=1",
  shift: "/planning?nuovo=oggi",
  team: "/staff",
};

/**
 * «Primi passi» in testa alla Home, gemella della card dell'app: stessi passi
 * (`computeFirstSteps`), stessi testi, il bottone sul prossimo da fare. Sparisce
 * a lavoro finito o quando la si chiude, e si chiude solo a prova avviata.
 */
export function FirstStepsCard() {
  const { session } = useAuth();
  const { workspaceId } = useOwnerVenues();
  const userId = session?.user.id;
  const key = userId && workspaceId ? `${userId}.${workspaceId}` : null;
  /** Chiusa in questa sessione: lo storage può non scrivere (navigazione privata). */
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // `localStorage` è sincrono: si legge in render, senza un giro a vuoto.
  const memory: FirstStepsMemory | null | undefined = key === null
    ? undefined
    : dismissedKey === key
      ? "dismissed"
      : loadFirstStepsMemory(userId!, workspaceId!);
  const steps = useFirstSteps(memory === null);

  const finished = memory === null && steps.visible && steps.ready && steps.allDone;
  useEffect(() => {
    if (finished && userId && workspaceId) saveFirstStepsMemory(userId, workspaceId, "completed");
  }, [finished, userId, workspaceId]);

  if (memory !== null || !steps.visible || !steps.ready || steps.allDone || !key) return null;

  const dismiss = () => {
    setDismissedKey(key);
    if (userId && workspaceId) saveFirstStepsMemory(userId, workspaceId, "dismissed");
  };

  const total = steps.steps.length;
  return (
    <section
      aria-labelledby="first-steps-title"
      className="mb-6 rounded-2xl border border-border-gold bg-bg-card p-5 print:hidden"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">
            Primi passi · {steps.doneCount} di {total}
          </p>
          <h2 id="first-steps-title" className="mt-1 font-serif text-xl text-t1">
            Prepara la tua azienda
          </h2>
        </div>
        {steps.canDismiss ? (
          <button
            type="button"
            onClick={dismiss}
            className="focus-gold rounded-lg px-2 py-1 text-xs text-t3 hover:bg-bg-2 hover:text-t1"
          >
            Nascondi
          </button>
        ) : null}
      </div>

      <div
        className="mt-4 h-1 overflow-hidden rounded-full bg-bg-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={steps.doneCount}
        aria-label="Passi completati"
      >
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(steps.doneCount / total) * 100}%` }} />
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {steps.steps.map((step, i) => {
          const done = step.status === "done";
          const locked = step.status === "locked";
          const isNext = steps.next?.id === step.id;
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                  done ? "border-gold bg-gold text-gold-ink" : "border-border-2 bg-bg-1 text-t2"
                )}
              >
                {done ? "✓" : locked ? "🔒" : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-semibold", done ? "text-t3 line-through" : locked ? "text-t3" : "text-t1")}>
                  {step.title}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-t3">
                  {locked ? "Dopo l’avvio della prova." : step.detail}
                </span>
              </span>
            </>
          );
          const className = cn(
            "flex h-full gap-3 rounded-xl border p-3 text-left",
            isNext ? "border-border-gold bg-bg-2" : "border-border-2",
          );
          return (
            <li key={step.id}>
              {locked ? (
                <div className={cn(className, "opacity-70")} aria-disabled>{body}</div>
              ) : (
                <Link to={ROUTES[step.id]} className={cn(className, "focus-gold transition hover:border-border-gold")}>
                  <span className="sr-only">{done ? "Fatto: " : "Da fare: "}</span>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {steps.next ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            to={ROUTES[steps.next.id]}
            className="focus-gold inline-flex rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
          >
            {steps.next.cta}
          </Link>
          {steps.next.id === "people" && !steps.hasSelfCard ? (
            <Link to="/staff?aggiungi=me" className="focus-gold text-sm text-gold underline">
              Lavori anche tu? Mettiti nel team
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
