import { useState } from "react";
import { Link } from "react-router-dom";
import { collaboratorSummary } from "@/features/team/collaboratorSummary";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";

const key = (memberId: string) => `welcome.${memberId}`;

function seen(memberId: string): boolean {
  try {
    return window.localStorage.getItem(key(memberId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Il benvenuto di chi entra da `#/invito` come collaboratore: cosa può fare, su
 * quali sedi, cosa resta al titolare, e da dove cominciare. Prima arrivava in
 * Home senza una parola, con un menu già filtrato e nessun perché.
 * Si chiude una volta per appartenenza (localStorage).
 */
export function CollaboratorWelcome() {
  const { authority, workspaceId, memberships } = useOwnerVenues();
  const membership = memberships.find((m) => m.workspace_id === workspaceId);
  const [closed, setClosed] = useState<string | null>(null);

  if (authority !== "collaborator" || !membership) return null;
  const id = membership.member_id;
  if (closed === id || seen(id)) return null;

  const s = collaboratorSummary(membership);
  const close = () => {
    setClosed(id);
    try {
      window.localStorage.setItem(key(id), "1");
    } catch {
      // Non ricordarlo costa un benvenuto in più.
    }
  };

  return (
    <section
      aria-labelledby="collaborator-welcome"
      className="mb-6 rounded-2xl border border-border-gold bg-bg-card p-5 print:hidden"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Benvenuto</p>
          <h2 id="collaborator-welcome" className="mt-1 font-serif text-xl text-t1">
            Collabori con {s.workspaceName}
          </h2>
        </div>
        <button
          type="button"
          onClick={close}
          className="focus-gold rounded-lg px-2 py-1 text-xs text-t3 hover:bg-bg-2 hover:text-t1"
        >
          Ho capito
        </button>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">Cosa puoi fare</h3>
          {s.can.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {s.can.map((c) => (
                <li key={c.perm}>
                  <span className="font-semibold text-t1">{c.label}</span>
                  <span className="block text-xs text-t3">{c.hint}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-t2">
              Per ora puoi consultare. I permessi li assegna il titolare.
            </p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">Dove</h3>
          <p className="mt-2 text-sm text-t2">{s.venues}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-t3">Al titolare</h3>
          <p className="mt-2 text-sm text-t2">{s.ownerKeeps}</p>
        </div>
      </div>

      {s.start ? (
        <Link
          to={s.start.path}
          onClick={close}
          className="focus-gold mt-5 inline-flex rounded-xl bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition hover:bg-gold-light"
        >
          {s.start.label}
        </Link>
      ) : null}
    </section>
  );
}
