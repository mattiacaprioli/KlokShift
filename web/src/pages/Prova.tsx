import { useNavigate } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial } from "@/features/workspace/hooks";
import { TRIAL_COPY } from "@/features/workspace/trialCopy";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "../ui/Toast";
import { AuthPanel, AuthShell } from "../ui/AuthShell";
import { Button } from "../ui/primitives";

/**
 * L'ultimo passo del setup, a tutta pagina come la creazione dell'azienda che
 * lo precede: avviare la prova di 30 giorni.
 *
 * La pagina è la conferma (docs/MONETIZATION.md §3, attivazione esplicita): un
 * solo bottone, niente secondo «sei sicuro?». «Più tardi» porta alla Home, dove
 * la checklist e il banner la ripropongono. Gli stessi testi dell'app
 * (`TRIAL_COPY`); listino e acquisto restano in Piano.
 */
export function ProvaPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { workspaceId, access, accessPending, isOwner } = useOwnerVenues();
  const trial = useStartWorkspaceTrial();

  const home = () => navigate("/", { replace: true });
  const alreadyActive = !accessPending && !!access && access.state !== "setup";
  const canStart =
    !!workspaceId && isOwner && access?.state === "setup" && (access.usage?.venues ?? 0) > 0;

  async function start() {
    if (!workspaceId || trial.isPending) return;
    try {
      await trial.mutateAsync(workspaceId);
      toast.show(TRIAL_COPY.started);
      home();
    } catch {
      // L'errore resta sotto il bottone (trial.error).
    }
  }

  return (
    <AuthShell
      title={TRIAL_COPY.title}
      subtitle={alreadyActive ? TRIAL_COPY.alreadyActive : TRIAL_COPY.lead}
    >
      {!alreadyActive ? (
        <AuthPanel>
          <ul className="flex flex-col gap-3">
            {TRIAL_COPY.points.map((point) => (
              <li key={point} className="flex gap-3 text-sm leading-6 text-t1">
                <span
                  aria-hidden
                  className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"
                >
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                    <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </AuthPanel>
      ) : null}

      {trial.error ? (
        <p className="mt-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
          {userErrorMessage(trial.error)}
        </p>
      ) : null}
      {!alreadyActive && !accessPending && !canStart ? (
        <p className="mt-4 text-center text-sm text-t3">
          {isOwner ? "Per avviare la prova serve una sede aperta." : "La prova la avvia il titolare dell’azienda."}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        {alreadyActive ? (
          <Button variant="gold" onClick={home}>Vai alla Home</Button>
        ) : (
          <>
            <Button variant="gold" disabled={!canStart || trial.isPending} onClick={() => void start()}>
              {trial.isPending ? TRIAL_COPY.pending : TRIAL_COPY.cta}
            </Button>
            <Button disabled={trial.isPending} onClick={home}>{TRIAL_COPY.later}</Button>
            <p className="mt-1 text-center text-xs text-t4">{TRIAL_COPY.laterNote}</p>
          </>
        )}
      </div>
    </AuthShell>
  );
}
