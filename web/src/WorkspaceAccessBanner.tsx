import { Link, useLocation } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { workspaceAccessMessage } from "@/features/workspace/access";

/** Avviso compatto; dettaglio e avvio della prova nella pagina del titolare. */
export function WorkspaceAccessBanner() {
  const { workspaceId, access, accessPending, accessError, isOwner } = useOwnerVenues();
  const { pathname } = useLocation();
  if (!workspaceId || pathname === "/piano") return null;
  const current = accessError ? undefined : access;
  const until = current?.state === "archive" ? current.archive_until : current?.operational_until;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-2 bg-bg-card px-4 py-3 print:hidden">
      <div role="status">
        <p className="text-sm text-t2">{accessPending ? "Verifica dello stato dell’azienda…" : workspaceAccessMessage(current)}</p>
        {until ? <p className="mt-1 text-xs text-t3">{current?.state === "archive" ? "Archivio fino al" : current?.source === "trial" ? "Fine prova:" : "Fine operatività:"} {new Date(until).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}</p> : null}
      </div>
      {isOwner ? <Link className="focus-gold text-sm text-gold underline" to="/piano">Piano e accesso</Link> : null}
    </div>
  );
}
