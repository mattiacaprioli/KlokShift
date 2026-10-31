import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { LEGAL_COPY, legalBody, legalWaiting } from "@/features/legal/copy";
import type { LegalGate } from "@/features/legal/gate";
import { useAcceptLegalTerms } from "@/features/legal/hooks";
import { LegalDocLinks } from "../legal/LegalCheckbox";
import { Button } from "../ui/primitives";
import { SupportLine } from "../ui/SupportLine";

/**
 * Il blocco della dashboard finché un titolare non accetta termini e accordo
 * sul trattamento dei dati. Stessa regola dell'app (`LegalAcceptanceScreen`):
 * ferma la gestione, mai il lavoro del team.
 */
export function AccettaTerminiPage({ gate }: { gate: LegalGate }) {
  const { signOut } = useAuth();
  const accept = useAcceptLegalTerms();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-4 h-1 w-12 rounded-full bg-gold" />
        <h1 className="font-serif text-2xl text-t1">{LEGAL_COPY.title}</h1>

        <div className="mt-6 flex flex-col gap-4">
          {gate.toAccept.map((w) => (
            <div key={w.workspaceId} className="flex flex-col gap-3 rounded-2xl border border-border-2 bg-bg-1 p-5">
              <p className="text-sm leading-6 text-t1">{legalBody(w.workspaceName)}</p>
              <LegalDocLinks />
              <Button
                variant="gold"
                disabled={accept.isPending}
                onClick={() => accept.mutate(w.workspaceId)}
              >
                {accept.isPending ? LEGAL_COPY.accepting : LEGAL_COPY.accept}
              </Button>
            </div>
          ))}
          {gate.waiting.map((w) => (
            <div key={w.workspaceId} className="rounded-2xl border border-border-2 bg-bg-1 p-5">
              <p className="text-sm leading-6 text-t2">{legalWaiting(w.workspaceName)}</p>
            </div>
          ))}
          {accept.error ? (
            <p className="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {userErrorMessage(accept.error)}
            </p>
          ) : null}
        </div>

        <Button className="mt-6" onClick={() => void signOut()}>
          Esci
        </Button>
        <SupportLine className="mt-8" />
      </div>
    </main>
  );
}
