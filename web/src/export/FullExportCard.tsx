import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card } from "../ui/primitives";
import { downloadFullExport } from "./fullExport";

/**
 * «Scarica tutti i dati»: lo storico completo dell'azienda in un pacchetto ZIP,
 * anche in archivio. Lo vede chi gestisce (titolare, o collaboratore con
 * Organico e Ore); il server ricontrolla che il collaboratore abbia tutte le sedi.
 */
export function FullExportCard({ compact = false }: { compact?: boolean }) {
  const { workspaceId, isOwner, canAny } = useOwnerVenues();
  const [progress, setProgress] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => downloadFullExport(workspaceId!, setProgress),
    onSettled: () => setProgress(null),
  });
  if (!workspaceId || !(isOwner || (canAny("can_manage_staff") && canAny("can_view_hours")))) return null;
  const body = <>
    <p className="mt-2 text-sm text-t2">Un pacchetto ZIP con tutto lo storico, dal primo giorno: sedi, persone, turni, presenze con timbrature e ore approvate, assenze e documenti. I file si aprono in Excel. Le chat non sono incluse.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Preparazione…" : "Scarica tutti i dati"}</Button>
      {progress ? <span className="text-xs text-t3" role="status">{progress}</span> : null}
    </div>
    {run.error ? <p className="mt-3 text-sm text-error" role="alert">{userErrorMessage(run.error)}</p> : null}
  </>;
  return compact ? <div className="mt-5 border-t border-border-2 pt-5"><h3 className="font-semibold text-t1">Export completo</h3>{body}</div>
    : <Card><h2 className="font-semibold text-t1">Export completo</h2>{body}</Card>;
}
