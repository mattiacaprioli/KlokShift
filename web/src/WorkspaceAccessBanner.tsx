import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { workspaceAccessMessage } from "@/features/workspace/access";
import { useStartWorkspaceTrial } from "@/features/workspace/hooks";
import { userErrorMessage } from "@/lib/errors";
import { Button } from "./ui/primitives";

export function WorkspaceAccessBanner() {
  const { workspaceId, access, accessPending, isOwner, refetch } = useOwnerVenues();
  const trial = useStartWorkspaceTrial();
  if (!workspaceId) return null;
  const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  return (
    <div className="mb-5 space-y-2 rounded-xl border border-border-2 bg-bg-card p-4 print:hidden" role="status">
      <p className="text-sm text-t1">{accessPending ? "Verifica dello stato dell’azienda…" : workspaceAccessMessage(access)}</p>
      {access?.plan && access.usage ? <p className="text-xs text-t2">{access.plan === "base" ? "Base" : "Team"} · {access.usage.people} persone{access.limits.people !== null ? ` su ${access.limits.people}` : ""} · {access.usage.venues} sedi aperte su {access.limits.venues}</p> : null}
      {access?.limits.people === 30 && (access.usage?.people ?? 0) >= 28 ? <p className="text-xs text-gold">Capacità di 30 persone vicina o raggiunta. Il lavoro esistente continua.</p> : null}
      {access?.operational_until ? <p className="text-xs text-t3">Fine operatività: {date(access.operational_until)}</p> : null}
      {access?.state === "archive" && access.archive_until ? <p className="text-xs text-t3">Archivio fino al {date(access.archive_until)}</p> : null}
      {access?.state === "archive" && access.can_complete_attendance && access.attendance_until ? <p className="text-xs text-t3">Rettifiche pregresse fino al {date(access.attendance_until)}</p> : null}
      <div className="flex gap-2">
        {access?.state === "setup" && isOwner && (access.usage?.venues ?? 0) > 0 ? <Button disabled={trial.isPending} onClick={() => trial.mutate(workspaceId)}>Avvia la prova di 30 giorni</Button> : null}
        <Button disabled={accessPending} onClick={() => void refetch()}>Aggiorna stato</Button>
      </div>
      {trial.error ? <p className="text-sm text-t2">{userErrorMessage(trial.error)}</p> : null}
    </div>
  );
}
