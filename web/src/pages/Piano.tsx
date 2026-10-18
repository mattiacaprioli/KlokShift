import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useStartWorkspaceTrial, useWorkspaceBilling } from "@/features/workspace/hooks";
import { workspaceAccessMessage, type WorkspaceAccess } from "@/features/workspace/access";
import { hasOpenSubscription, type WorkspaceBilling } from "@/features/workspace/billing";
import { LEGAL_URLS } from "@/features/account/legal";
import { userErrorMessage } from "@/lib/errors";
import { EXTRA_VENUE_PRICES, formatEuro, quotePlan } from "../../../shared/pricing";
import { openCheckout, prepareCheckout } from "../billing/checkout";
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
              <Value label="Origine dell’accesso" value={current.source === "trial" ? "Prova gratuita" : current.source === "complimentary_lifetime" ? "Gratuito a vita" : current.source === "transition" ? "Accesso transitorio" : current.source === "subscription" ? "Abbonamento" : current.source === "payment_grace" ? "Rinnovo in sospeso" : current.source ? "Concessione a tempo" : "Non assegnato"} />
              <Value label="Persone in azienda" value={current.usage?.people ?? "Non disponibile"} />
              <Value label="Limite persone" value={!current.plan ? "Non assegnato" : current.limits.people === null ? "Senza limite" : current.limits.people} />
              <Value label="Sedi aperte" value={current.usage?.venues ?? "Non disponibile"} />
              <Value label="Sedi consentite" value={current.limits.venues ?? "Non assegnato"} />
              {current.operational_from ? <Value label="Inizio accesso" value={date(current.operational_from)} /> : null}
              {current.operational_until ? <Value label={current.source === "trial" ? "Fine prova" : current.source === "subscription" ? "Fine del periodo pagato" : current.source === "payment_grace" ? "Termine per il pagamento" : "Fine operatività"} value={date(current.operational_until)} /> : current.source === "complimentary_lifetime" ? <Value label="Scadenza" value="Senza scadenza commerciale" /> : null}
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

        {/* `refetch` è stabile (useCallback nel provider): l'attesa non riparte a ogni render. */}
        <BillingSection key={workspaceId} workspaceId={workspaceId} access={current} refetchAccess={refetch} />
      </div>
    </>
  );
}

function Value({ label, value }: { label: string; value: string | number | null }) {
  return <div><dt className="text-xs text-t3">{label}</dt><dd className="mt-1 font-medium text-t1">{value ?? "Non disponibile"}</dd></div>;
}

const dateOnly = (value: string) => new Date(value).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });
const ACTIVATION_TIMEOUT_MS = 90_000;

/**
 * Acquisto e abbonamento. Il diritto arriva solo dall'avviso firmato di Paddle:
 * dopo il pagamento la pagina rilegge lo stato finché l'abbonamento non c'è.
 */
function BillingSection({ workspaceId, access, refetchAccess }: {
  workspaceId: string; access: WorkspaceAccess | undefined; refetchAccess: () => Promise<unknown>;
}) {
  // idle → waiting (pagamento completato nel browser) → late (oltre il timeout).
  const [phase, setPhase] = useState<"idle" | "waiting" | "late">("idle");
  const waiting = phase !== "idle";
  const billing = useWorkspaceBilling(workspaceId, { refetchInterval: waiting ? 3_000 : false });
  const subscription = billing.data;
  const activated = hasOpenSubscription(subscription) && access?.source === "subscription";
  // L'avviso è arrivato: si torna alla vista normale (aggiornamento in render,
  // non in un effetto, come suggerisce React per lo stato derivato).
  if (waiting && activated) setPhase("idle");

  useEffect(() => {
    if (phase === "idle") return;
    const poll = setInterval(() => void refetchAccess(), 3_000);
    const timeout = phase === "waiting" ? setTimeout(() => setPhase("late"), ACTIVATION_TIMEOUT_MS) : undefined;
    return () => { clearInterval(poll); if (timeout) clearTimeout(timeout); };
  }, [phase, refetchAccess]);

  if (billing.isPending) return <Card><p className="text-sm text-t2">Verifica dell’abbonamento…</p></Card>;
  if (billing.isError) return <Card><p className="text-sm text-error" role="alert">{userErrorMessage(billing.error)}</p></Card>;

  if (waiting && !activated) {
    return (
      <Card>
        <h2 className="font-semibold text-t1">Pagamento ricevuto</h2>
        <p className="mt-2 text-sm text-t2" role="status">{phase === "late"
          ? "L’attivazione sta richiedendo più del previsto. Aggiorna lo stato fra qualche minuto; se non cambia, scrivici a info@klokshift.com."
          : "Stiamo attivando il piano: di solito bastano pochi secondi."}</p>
      </Card>
    );
  }
  if (hasOpenSubscription(subscription)) return <SubscriptionCard billing={subscription as WorkspaceBilling} />;
  if (!access || access.state === "expired") return null;
  if (access.source === "complimentary_lifetime" && access.state === "operational") return null;
  return <PurchasePanel workspaceId={workspaceId} access={access} onPaid={() => setPhase("waiting")} />;
}

function SubscriptionCard({ billing }: { billing: WorkspaceBilling }) {
  const stopping = billing.scheduled_change?.action === "cancel" || billing.scheduled_change?.action === "pause";
  return (
    <Card>
      <h2 className="font-semibold text-t1">Abbonamento</h2>
      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
        <Value label="Stato" value={billing.status === "active" ? "Attivo" : billing.status === "past_due" ? "Rinnovo non riuscito" : "In pausa"} />
        <Value label="Piano" value={`${billing.plan === "base" ? "Base" : "Team"} · ${billing.billing_interval === "year" ? "annuale" : "mensile"}`} />
        <Value label="Sedi comprese" value={1 + billing.extra_venues} />
        {billing.current_period_ends_at ? <Value label={stopping ? "Ultimo giorno" : "Prossimo rinnovo"} value={dateOnly(billing.scheduled_change?.effective_at ?? billing.current_period_ends_at)} /> : null}
      </dl>
      {billing.status === "past_due" && billing.past_due_since ? <p className="mt-5 text-sm text-gold" role="alert">Il rinnovo del {dateOnly(billing.past_due_since)} non è andato a buon fine. Paddle ritenta il pagamento; l’operatività continua per 7 giorni, poi resta la sola consultazione finché il pagamento non arriva.</p> : null}
      {stopping ? <p className="mt-5 text-sm text-t2">I rinnovi sono fermati: il servizio resta attivo fino all’ultimo giorno indicato, poi l’azienda passa alla consultazione ed export per 12 mesi.</p> : null}
      <p className="mt-5 text-xs text-t3">Per cambiare piano o sedi, aggiornare il metodo di pagamento o fermare i rinnovi scrivi a <a className="focus-gold text-gold underline" href="mailto:info@klokshift.com">info@klokshift.com</a>: la gestione diretta da questa pagina arriva a breve. Ricevute e rimborsi passano da Paddle.</p>
    </Card>
  );
}

function PurchasePanel({ workspaceId, access, onPaid }: {
  workspaceId: string; access: WorkspaceAccess; onPaid: () => void;
}) {
  const people = access.usage?.people ?? 0;
  const openVenues = Math.max(1, access.usage?.venues ?? 1);
  const baseAllowed = people <= 30;
  const [plan, setPlan] = useState<"base" | "team">(baseAllowed ? "base" : "team");
  const [interval, setBillingInterval] = useState<"month" | "year">("month");
  const [venues, setVenues] = useState(String(openVenues));
  const count = Number(venues);
  const validVenues = venues.trim() !== "" && Number.isSafeInteger(count) && count >= openVenues && count <= 1000;
  const quote = validVenues ? quotePlan(plan, interval === "year" ? "annual" : "monthly", count) : null;
  const inTrial = access.source === "trial" && access.state === "operational";

  const buy = useMutation({
    mutationFn: async () => {
      const prepared = await prepareCheckout({ workspaceId, plan, interval, extraVenues: count - 1 });
      return openCheckout(prepared);
    },
    onSuccess: (result) => { if (result === "completed") onPaid(); },
  });

  return (
    <Card>
      <h2 className="font-semibold text-t1">Attiva un abbonamento</h2>
      <p className="mt-2 text-sm text-t2">Entrambi i piani hanno le stesse funzioni e una sede inclusa: cambia solo quante persone e sedi puoi avere.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Field label="Piano" error={baseAllowed ? undefined : `Base arriva a 30 persone: oggi ne conti ${people}.`}>
          <Select value={plan} onChange={(e) => setPlan(e.target.value as "base" | "team")}>
            {baseAllowed ? <option value="base">Base · fino a 30 persone</option> : null}
            <option value="team">Team · senza limite di persone</option>
          </Select>
        </Field>
        <Field label="Periodo">
          <Select value={interval} onChange={(e) => setBillingInterval(e.target.value as "month" | "year")}>
            <option value="month">Mensile</option><option value="year">Annuale · 2 mesi gratuiti</option>
          </Select>
        </Field>
        <Field label="Sedi totali" error={validVenues ? undefined : `Almeno ${openVenues}: le sedi aperte oggi.`}>
          <Input type="number" min={openVenues} step={1} value={venues} onChange={(e) => setVenues(e.target.value)} />
        </Field>
      </div>
      {quote ? (
        <div className="mt-5 rounded-xl bg-bg-2 p-4">
          <p className="text-xl text-t1">{formatEuro(quote.total)} <span className="text-sm text-t3">{interval === "year" ? "all’anno" : "al mese"} + IVA</span></p>
          {interval === "year" ? <p className="mt-1 text-xs text-t3">Equivale a {formatEuro(quote.monthlyEquivalent)} al mese, per 12 mesi consecutivi.</p> : null}
          {count > 1 ? <p className="mt-1 text-xs text-t3">Comprende {count - 1} {count - 1 === 1 ? "sede aggiuntiva" : "sedi aggiuntive"} a {formatEuro(interval === "year" ? EXTRA_VENUE_PRICES.annual : EXTRA_VENUE_PRICES.monthly)} ciascuna.</p> : null}
        </div>
      ) : null}
      {inTrial ? <p className="mt-4 text-sm text-gold">Sei in prova: se acquisti ora, l’abbonamento e il primo addebito partono oggi e i giorni di prova rimasti non si sommano.</p> : null}
      <p className="mt-4 text-xs text-t3">
        L’IVA e le altre imposte le calcola Paddle, nostro rivenditore e Merchant of Record, prima del pagamento.
        L’abbonamento si rinnova da solo e puoi fermarlo quando vuoi; puoi chiedere il rimborso entro 14 giorni da ogni addebito.
        {" "}<a className="focus-gold text-gold underline" href={LEGAL_URLS.terms} target="_blank" rel="noreferrer">Termini</a>
        {" · "}<a className="focus-gold text-gold underline" href={LEGAL_URLS.refunds} target="_blank" rel="noreferrer">Rimborsi</a>
      </p>
      <div className="mt-5">
        <Button variant="gold" disabled={!quote || buy.isPending} onClick={() => buy.mutate()}>
          {buy.isPending ? "Apertura del pagamento…" : "Procedi al pagamento"}
        </Button>
      </div>
      {buy.error ? <p className="mt-3 text-sm text-error" role="alert">{userErrorMessage(buy.error)}</p> : null}
    </Card>
  );
}
