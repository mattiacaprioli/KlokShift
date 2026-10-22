import { useNavigate } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial } from "@/features/workspace/hooks";
import { TRIAL_COPY } from "@/features/workspace/trialCopy";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "../ui/Toast";
import { SupportLine } from "../ui/SupportLine";
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
  const { workspaceId, workspaceName, access, accessPending, isOwner } = useOwnerVenues();
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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-4 h-1 w-12 rounded-full bg-gold" />
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">
          {TRIAL_COPY.eyebrow}{workspaceName ? ` · ${workspaceName}` : ""}
        </p>
        <h1 className="mt-2 font-serif text-3xl text-t1">{TRIAL_COPY.title}</h1>
        <p className="mt-3 text-sm leading-6 text-t2">
          {alreadyActive ? TRIAL_COPY.alreadyActive : TRIAL_COPY.lead}
        </p>

        {!alreadyActive ? (
          <ul className="mt-6 space-y-3 rounded-2xl border border-border-2 bg-bg-card p-5">
            {TRIAL_COPY.points.map((point) => (
              <li key={point} className="flex gap-3 text-sm text-t1">
                <span aria-hidden className="font-bold text-gold">✓</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {trial.error ? (
          <p className="mt-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
            {userErrorMessage(trial.error)}
          </p>
        ) : null}
        {!alreadyActive && !accessPending && !canStart ? (
          <p className="mt-4 text-sm text-t3">
            {isOwner ? "Per avviare la prova serve una sede aperta." : "La prova la avvia il titolare dell’azienda."}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {alreadyActive ? (
            <Button variant="gold" onClick={home}>Vai alla Home</Button>
          ) : (
            <>
              <Button variant="gold" disabled={!canStart || trial.isPending} onClick={() => void start()}>
                {trial.isPending ? TRIAL_COPY.pending : TRIAL_COPY.cta}
              </Button>
              <Button disabled={trial.isPending} onClick={home}>{TRIAL_COPY.later}</Button>
              <span className="text-xs text-t4">{TRIAL_COPY.laterNote}</span>
            </>
          )}
        </div>
        <SupportLine className="mt-10" />
      </div>
    </main>
  );
}
