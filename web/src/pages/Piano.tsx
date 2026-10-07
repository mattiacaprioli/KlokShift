import { useState } from "react";
import { Link } from "react-router-dom";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial } from "@/features/workspace/hooks";
import { workspaceAccessMessage } from "@/features/workspace/access";
import { userErrorMessage } from "@/lib/errors";
import { formatEuro, quotePlan, type BillingCycle } from "../../../shared/pricing";
import { Button, Card, Field, Input, PageHeader, Placeholder, Select } from "../ui/primitives";

const date = (value: string) => new Date(value).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
const stateLabels = {
  setup: "Da configurare", operational: "Operativa", archive: "In archivio",
  expired: "Archivio terminato", migration_pending: "Configurazione in verifica",
};

/** I diritti arrivano da get_workspace_access; il listino è soltanto informativo. */
export function PianoPage() {
  const { workspaceId, workspaceName, isOwner, access, accessPending, accessError,
    historyVenueIds, canAny, refetch } = useOwnerVenues();
  const trial = useStartWorkspaceTrial();
  const [reviewingWorkspace, setReviewingWorkspace] = useState<string | null>(null);

  if (!isOwner) return <Placeholder title="Piano e accesso" detail="Questa sezione è riservata al titolare dell’azienda." />;
  if (!workspaceId) return <Placeholder title="Prepara la tua azienda" detail="Crea la prima sede. Potrai poi avviare la prova di 30 giorni senza carta." action={<Link className="focus-gold text-gold underline" to="/sede/nuovo">Crea la prima sede</Link>} />;

  // Un errore di refresh non rende validi i dati precedenti né l’attivazione.
  const current = accessError ? undefined : access;
  const canStart = !accessPending && current?.state === "setup" && (current.usage?.venues ?? 0) > 0;
  return (
    <>
      <PageHeader title="Piano e accesso" subtitle={workspaceName} actions={
        <Button disabled={accessPending || trial.isPending} onClick={() => void refetch()}>Aggiorna stato</Button>
      } />
      <div className="max-w-4xl space-y-5">
        <Card>
          <h2 className="text-lg font-semibold text-t1">Situazione attuale</h2>
          <p className="mt-2 text-sm text-t2" role="status">{accessPending ? "Verifica dello stato dell’azienda…" : workspaceAccessMessage(current)}</p>
          {current ? (
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
              <Value label="Stato" value={stateLabels[current.state]} />
              <Value label="Piano" value={current.plan === "base" ? "Base" : current.plan === "team" ? "Team" : "Non assegnato"} />
              <Value label="Origine dell’accesso" value={current.source === "trial" ? "Prova gratuita" : current.source === "complimentary_lifetime" ? "Gratuito a vita" : current.source === "transition" ? "Accesso transitorio" : current.source ? "Concessione a tempo" : "Non assegnato"} />
              <Value label="Persone in azienda" value={current.usage?.people ?? "Non disponibile"} />
              <Value label="Limite persone" value={!current.plan ? "Non assegnato" : current.limits.people === null ? "Senza limite" : current.limits.people} />
              <Value label="Sedi aperte" value={current.usage?.venues ?? "Non disponibile"} />
              <Value label="Sedi consentite" value={current.limits.venues ?? "Non assegnato"} />
              {current.operational_from ? <Value label="Inizio accesso" value={date(current.operational_from)} /> : null}
              {current.operational_until ? <Value label={current.source === "trial" ? "Fine prova" : "Fine operatività"} value={date(current.operational_until)} /> : current.source === "complimentary_lifetime" ? <Value label="Scadenza" value="Senza scadenza commerciale" /> : null}
              {current.attendance_until ? <Value label="Termine rettifiche pregresse" value={date(current.attendance_until)} /> : null}
              {current.archive_until ? <Value label="Termine consultazione ed export" value={date(current.archive_until)} /> : null}
            </dl>
          ) : null}
          {current?.state === "migration_pending" ? <p className="mt-5 text-sm text-t2">Questa azienda esisteva già prima dei nuovi piani. Il piano e i limiti devono essere assegnati esplicitamente; la prova non parte automaticamente.</p> : null}
          {current?.source === "complimentary_lifetime" ? <p className="mt-5 text-sm text-t2">La gratuità vale per questa azienda e per la capacità indicata. Non prevede pagamenti o rinnovi.</p> : null}
          {current?.plan && current.usage ? <p className="mt-5 text-xs text-t3">Ogni persona conta una volta nell’azienda, anche se lavora in più sedi. I gestori senza appartenenza all’organico non consumano posti.</p> : null}
          {current?.limits.people === 30 && (current.usage?.people ?? 0) >= 28 ? <p className="mt-3 text-sm text-gold">Il limite di 30 persone è vicino o raggiunto. Le persone e i turni già presenti restano utilizzabili.</p> : null}
          {current?.state === "setup" ? (
            <div className="mt-5 space-y-3 border-t border-border-2 pt-5">
              <p className="text-sm text-t2">La prova include tutte le funzioni del piano Team e una sede, per 30 giorni. Inizia quando confermi l’avvio e non richiede una carta.</p>
              {canStart ? reviewingWorkspace === workspaceId ? (
                <div className="space-y-3 rounded-xl bg-bg-2 p-4">
                  <p className="text-sm text-t1">Vuoi iniziare ora? I 30 giorni decorrono dalla conferma. La prova è unica per questa azienda e non si rinnova a pagamento.</p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="gold" disabled={trial.isPending} onClick={() => trial.mutate(workspaceId, { onSuccess: () => setReviewingWorkspace(null) })}>{trial.isPending ? "Avvio…" : "Conferma e avvia la prova"}</Button>
                    <Button disabled={trial.isPending} onClick={() => setReviewingWorkspace(null)}>Annulla</Button>
                  </div>
                </div>
              ) : <Button variant="gold" onClick={() => setReviewingWorkspace(workspaceId)}>Avvia la prova di 30 giorni</Button> : <Link className="focus-gold text-sm text-gold underline" to="/sede/nuovo">Prepara la prima sede</Link>}
            </div>
          ) : null}
          {trial.error ? <p className="mt-3 text-sm text-error" role="alert">{userErrorMessage(trial.error)}</p> : null}
        </Card>

        {historyVenueIds.length > 0 ? (
          <Card>
            <h2 className="font-semibold text-t1">Storico e dati</h2>
            <p className="mt-2 text-sm text-t2">{current?.state === "expired" ? "Il periodo di consultazione è terminato." : "Trovi qui i turni e i riepiloghi delle sedi a cui hai accesso, comprese quelle chiuse."}</p>
            <div className="mt-4 flex flex-wrap gap-5 text-sm text-gold">
              <Link className="focus-gold underline" to="/storico">Storico turni</Link>
              {canAny("can_view_hours") ? <Link className="focus-gold underline" to="/ore">Ore ed export</Link> : null}
            </div>
            {current?.state === "archive" && current.can_complete_attendance ? <p className="mt-3 text-sm text-t2">Puoi ancora completare le presenze pregresse entro il termine indicato. Questa finestra non consente di creare nuovi turni e non prolunga l’archivio.</p> : null}
          </Card>
        ) : null}

        <PlanPreview key={workspaceId} />
      </div>
    </>
  );
}

function Value({ label, value }: { label: string; value: string | number | null }) {
  return <div><dt className="text-xs text-t3">{label}</dt><dd className="mt-1 font-medium text-t1">{value ?? "Non disponibile"}</dd></div>;
}

function PlanPreview() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [venues, setVenues] = useState("1");
  const count = Number(venues);
  let valid = false;
  try { quotePlan("team", cycle, count); valid = venues.trim() !== ""; } catch { /* Nessun importo per input non valido. */ }
  return (
    <Card>
      <details>
        <summary className="focus-gold cursor-pointer font-semibold text-t1">Listino previsto al lancio</summary>
        <p className="mt-3 text-sm text-t2">Entrambi i piani includono le stesse funzioni e una sede. I pagamenti non sono ancora disponibili: questo riepilogo non cambia il tuo piano.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Periodo">
            <Select value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)}>
              <option value="monthly">Mensile</option><option value="annual">Annuale · 2 mesi gratuiti</option>
            </Select>
          </Field>
          <Field label="Sedi totali" error={valid ? undefined : "Indica un numero intero di sedi, almeno una."}>
            <Input type="number" min={1} step={1} value={venues} onChange={(e) => setVenues(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {(["base", "team"] as const).map((plan) => (
            <div key={plan} className="rounded-xl border border-border-2 p-4">
              <h3 className="font-semibold text-t1">{plan === "base" ? "Base · fino a 30 persone" : "Team · senza limite persone"}</h3>
              {valid ? <><p className="mt-3 text-xl text-t1">{formatEuro(quotePlan(plan, cycle, count).total)} <span className="text-sm text-t3">{cycle === "annual" ? "all’anno" : "al mese"}</span></p>{cycle === "annual" ? <p className="mt-1 text-xs text-t3">Equivale a {formatEuro(quotePlan(plan, cycle, count).monthlyEquivalent)} al mese. Pagamento annuale per 12 mesi consecutivi.</p> : null}</> : <p className="mt-3 text-sm text-t3">Importo non disponibile</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-t3">IVA esclusa. Ogni sede oltre la prima costa 15 € al mese o 150 € all’anno. L’annuale costa 10 mensilità e copre 12 mesi consecutivi.</p>
      </details>
    </Card>
  );
}
