import { useState } from "react";
import { useAdminRead } from "@/features/admin/hooks";
import { currentMonth, formatMoney, getAdminFinance, getAdminWorkspaceFinance, shiftMonth } from "@/features/admin/finance";
import type { FinanceEnvironment } from "@/features/admin/finance";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card, Pill, Spinner } from "../ui/primitives";

const monthLabel = (month: string) => new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${month}-01T00:00:00Z`));
function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeZone: "Europe/Rome" }).format(new Date(value));
}
const originLabels: Record<string, string> = {
  api: "Primo acquisto", web: "Primo acquisto", subscription_recurring: "Rinnovo", subscription_update: "Aumento",
};
const statusLabels = { active: "Attivo", past_due: "Rinnovo in sospeso", paused: "In pausa", canceled: "Chiuso" };

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
    <span className="text-t3">{label}</span>
    <span className="text-right font-mono text-t1">{value}{detail ? <span className="ml-2 text-xs text-t4">{detail}</span> : null}</span>
  </div>;
}

function EnvironmentBlock({ e }: { e: FinanceEnvironment }) {
  const m = (v: number) => formatMoney(v, e.currency);
  const p = e.payments;
  return <div className={e.environment === "sandbox" ? "rounded-xl border border-dashed border-border-2 p-4" : "rounded-xl bg-bg-2 p-4"}>
    <div className="mb-2 flex items-center gap-2">
      <h3 className="font-semibold">{e.environment === "live" ? "Clienti reali" : "Sandbox"}</h3>
      {e.environment === "sandbox" ? <Pill>Prove, non sono incassi</Pill> : null}
    </div>
    <Row label="MRR contrattuale" value={m(e.mrr_cents)} detail="IVA esclusa, annuale / 12" />
    {e.at_risk_mrr_cents > 0 ? <Row label="Ricavo a rischio" value={m(e.at_risk_mrr_cents)} detail="rinnovi in sospeso" /> : null}
    <Row label="Abbonamenti" value={`${e.subscriptions.active} attivi`}
      detail={`${e.subscriptions.past_due} in sospeso · ${e.subscriptions.paused} in pausa · ${e.subscriptions.cancel_scheduled} in chiusura`} />
    <div className="my-2 border-t border-border-2" />
    <Row label="Pagamenti del mese" value={String(p.count)}
      detail={`${p.first_purchases} primi acquisti · ${p.renewals} rinnovi · ${p.upgrades} aumenti`} />
    <Row label="Pagato dai clienti" value={m(p.gross_cents)} detail="IVA compresa" />
    <Row label="IVA" value={m(p.tax_cents)} />
    <Row label="Commissioni Paddle" value={m(p.fee_cents)} />
    <Row label="Netto riconosciuto da Paddle" value={m(p.earnings_cents)} />
    {e.refunds.count > 0 ? <Row label={`Rimborsi del mese (${e.refunds.count})`} value={`−${m(e.refunds.total_cents)}`}
      detail={`netto stornato −${m(e.refunds.earnings_cents)}`} /> : null}
  </div>;
}

/** Panoramica: MRR e incassi verificati del mese, per ambiente. */
export function FinanceOverview({ userId }: { userId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const query = useAdminRead(userId, "finance", { month }, () => getAdminFinance(month));
  return <Card>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Incassi</h2>
      <div className="flex items-center gap-2">
        <Button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mese precedente">←</Button>
        <span className="min-w-36 text-center text-sm capitalize">{monthLabel(month)}</span>
        <Button disabled={month >= currentMonth()} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mese successivo">→</Button>
      </div>
    </div>
    {query.isPending || query.isFetching ? <Spinner />
      : query.isError ? <p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p>
      : query.data.environments.length === 0 ? <p className="text-sm text-t3">Nessun abbonamento né pagamento registrato.</p>
      : <div className="grid gap-4 lg:grid-cols-2">{query.data.environments.map((e) => <EnvironmentBlock key={`${e.environment}-${e.currency}`} e={e} />)}</div>}
    <p className="mt-4 text-xs text-t4">Dati verificati dagli avvisi di Paddle (rivenditore e Merchant of Record): il pagato è la vendita di Paddle al cliente, il netto è quanto Paddle riconosce a KlokShift dopo IVA e commissioni. Payout, cioè i bonifici di Paddle, e costi non sono ancora collegati. Non è un risultato fiscale.</p>
  </Card>;
}

/** Scheda azienda: abbonamento, MRR e ultimi pagamenti di quell'azienda. */
export function WorkspaceFinancePanel({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const query = useAdminRead(userId, "workspace-finance", workspaceId, () => getAdminWorkspaceFinance(workspaceId));
  if (query.isPending || query.isFetching) return <Card><h2 className="mb-3 font-semibold">Abbonamento e pagamenti</h2><Spinner /></Card>;
  if (query.isError) return <Card><h2 className="mb-3 font-semibold">Abbonamento e pagamenti</h2><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  return <Card>
    <h2 className="mb-3 font-semibold">Abbonamento e pagamenti</h2>
    {d.subscriptions.length === 0 ? <p className="text-sm text-t3">Nessun abbonamento Paddle: MRR e incassi pari a zero.</p>
      : d.subscriptions.map((s) => <div key={`${s.environment}-${s.created_at}`} className="mb-2 text-sm">
          <span className="font-semibold">{s.plan === "base" ? "Base" : "Team"} · {s.billing_interval === "year" ? "annuale" : "mensile"} · {1 + s.extra_venues} {s.extra_venues === 0 ? "sede" : "sedi"}</span>
          <span className="text-t3"> · {statusLabels[s.status]}{s.scheduled_change === "cancel" ? ", in chiusura" : s.scheduled_change === "pause" ? ", pausa programmata" : ""}</span>
          {s.environment === "sandbox" ? <span className="ml-2"><Pill>Sandbox</Pill></span> : null}
          <p className="text-xs text-t3">MRR {formatMoney(s.mrr_cents, s.currency)} · ricorrente {formatMoney(s.recurring_cents, s.currency)} {s.billing_interval === "year" ? "all’anno" : "al mese"} IVA esclusa{s.current_period_ends_at ? ` · periodo fino al ${date(s.current_period_ends_at)}` : ""}</p>
        </div>)}
    {d.payments.length > 0 ? <ul className="mt-3 divide-y divide-border-2 text-sm">{d.payments.map((p, i) => <li key={`${p.billed_at}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
        <span>{date(p.billed_at)} · {originLabels[p.origin ?? ""] ?? "Pagamento"}{p.environment === "sandbox" ? " (sandbox)" : ""}</span>
        <span className="font-mono">{formatMoney(p.gross_cents, p.currency ?? "EUR")} <span className="text-xs text-t4">netto {formatMoney(p.earnings_cents, p.currency ?? "EUR")}</span></span>
      </li>)}</ul> : null}
    {d.refunds.length > 0 ? <p className="mt-3 text-sm text-t3">Rimborsi e contestazioni: {d.refunds.length}. Il dettaglio è in «Rimborsi e contestazioni».</p> : null}
    <p className="mt-3 text-xs text-t4">Costi per azienda non disponibili: non sono ancora collegati.</p>
  </Card>;
}
