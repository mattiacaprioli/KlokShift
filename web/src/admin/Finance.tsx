import { useState } from "react";
import { useAdminRead } from "@/features/admin/hooks";
import { currentMonth, formatMoney, getAdminFinance, getAdminWorkspaceFinance, shiftMonth } from "@/features/admin/finance";
import type { FinanceEnvironment } from "@/features/admin/finance";
import { userErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Card, Pill } from "../ui/primitives";
import { CardSkeleton, Dot, Icon, SectionHeader } from "./ui";
import { day as date } from "./format";

const monthLabel = (month: string) => new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${month}-01T00:00:00Z`));
const originLabels: Record<string, string> = {
  api: "Primo acquisto", web: "Primo acquisto", subscription_recurring: "Rinnovo", subscription_update: "Aumento",
};
const statusLabels = { active: "Attivo", past_due: "Rinnovo in sospeso", paused: "In pausa", canceled: "Chiuso" };
const subscriptionTone = { active: "success", past_due: "warning", paused: "neutral", canceled: "neutral" } as const;

function Row({ label, value, detail, swatch, tone }: { label: string; value: string; detail?: string; swatch?: string; tone?: "error" }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
    <span className="flex items-center gap-2 text-t3">{swatch ? <span aria-hidden className={cn("size-2.5 rounded-sm", swatch)} /> : null}{label}</span>
    <span className={cn("text-right font-mono tabular-nums", tone === "error" ? "text-error" : "text-t1")}>{value}{detail ? <span className="ml-2 font-sans text-xs text-t4">{detail}</span> : null}</span>
  </div>;
}

/** Il pagato diviso in IVA, commissioni e netto: tre quote dello stesso totale. */
function PaymentSplit({ e }: { e: FinanceEnvironment }) {
  const p = e.payments;
  const parts = [
    { key: "earnings", label: "Netto", value: Math.max(0, p.earnings_cents), cls: "bg-gold" },
    { key: "fee", label: "Commissioni", value: Math.max(0, p.fee_cents), cls: "bg-t2" },
    { key: "tax", label: "IVA", value: Math.max(0, p.tax_cents), cls: "bg-t4" },
  ];
  const total = parts.reduce((sum, x) => sum + x.value, 0);
  if (!total) return null;
  return <div className="mb-2 mt-1 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img"
    aria-label={parts.map((x) => `${x.label} ${formatMoney(x.value, e.currency)}`).join(", ")}>
    {parts.filter((x) => x.value > 0).map((x) => <div key={x.key} className={cn("h-full", x.cls)} style={{ width: `${(x.value / total) * 100}%` }}
      title={`${x.label}: ${formatMoney(x.value, e.currency)} (${Math.round((x.value / total) * 100)}%)`} />)}
  </div>;
}

function Counter({ value, label, tone }: { value: number; label: string; tone: "success" | "warning" | "neutral" | "error" }) {
  return <div className="rounded-xl bg-bg-1 px-3 py-2">
    <p className="font-serif text-xl tabular-nums text-t1">{value}</p>
    <p className="flex items-center gap-1.5 whitespace-nowrap text-xs text-t3"><Dot tone={value ? tone : "neutral"} />{label}</p>
  </div>;
}

function EnvironmentBlock({ e }: { e: FinanceEnvironment }) {
  const m = (v: number) => formatMoney(v, e.currency);
  const p = e.payments;
  const sandbox = e.environment === "sandbox";
  return <div className={sandbox ? "rounded-2xl border border-dashed border-border-2 p-5 opacity-80" : "rounded-2xl border border-border-gold bg-linear-to-br from-gold/[0.07] to-transparent p-5"}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-semibold">{e.environment === "live" ? "Clienti reali" : "Sandbox"}</h3>
      {sandbox ? <Pill>Prove, non sono incassi</Pill> : null}
    </div>
    <p className="mt-4 text-xs text-t3">MRR contrattuale</p>
    <p className={cn("font-serif text-4xl tabular-nums leading-tight", sandbox ? "text-t2" : "text-gold")}>{m(e.mrr_cents)}</p>
    <p className="text-xs text-t4">IVA esclusa, annuale / 12</p>
    {e.at_risk_mrr_cents > 0 ? <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs font-semibold text-warning">
      Ricavo a rischio {m(e.at_risk_mrr_cents)} · rinnovi in sospeso</p> : null}
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Abbonamenti">
      <Counter value={e.subscriptions.active} label="attivi" tone="success" />
      <Counter value={e.subscriptions.past_due} label="in sospeso" tone="warning" />
      <Counter value={e.subscriptions.paused} label="in pausa" tone="neutral" />
      <Counter value={e.subscriptions.cancel_scheduled} label="in chiusura" tone="error" />
    </div>
    <div className="mt-5 border-t border-border-2 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Pagamenti del mese <span className="ml-1 font-mono text-t3">{p.count}</span></h4>
        <span className="text-xs text-t4">{p.first_purchases} primi acquisti · {p.renewals} rinnovi · {p.upgrades} aumenti</span>
      </div>
      <PaymentSplit e={e} />
      <Row label="Pagato dai clienti" value={m(p.gross_cents)} detail="IVA compresa" />
      <Row label="IVA" value={m(p.tax_cents)} swatch="bg-t4" />
      <Row label="Commissioni Paddle" value={m(p.fee_cents)} swatch="bg-t2" />
      <Row label="Netto riconosciuto da Paddle" value={m(p.earnings_cents)} swatch="bg-gold" />
      {e.refunds.count > 0 ? <Row label={`Rimborsi del mese (${e.refunds.count})`} value={`−${m(e.refunds.total_cents)}`}
        detail={`netto stornato −${m(e.refunds.earnings_cents)}`} tone="error" /> : null}
    </div>
  </div>;
}

/** Panoramica: MRR e incassi verificati del mese, per ambiente. */
export function FinanceOverview({ userId }: { userId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const query = useAdminRead(userId, "finance", { month }, () => getAdminFinance(month));
  return <Card>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Mese di riferimento</h2>
      <div className="flex items-center rounded-xl border border-border-2 bg-bg-1 p-1">
        <MonthButton label="Mese precedente" icon="chevronLeft" onClick={() => setMonth((m) => shiftMonth(m, -1))} />
        <span className="min-w-36 text-center text-sm font-semibold capitalize">{monthLabel(month)}</span>
        <MonthButton label="Mese successivo" icon="chevronRight" disabled={month >= currentMonth()} onClick={() => setMonth((m) => shiftMonth(m, 1))} />
      </div>
    </div>
    {query.isPending || query.isFetching ? <div className="grid gap-4 lg:grid-cols-2" aria-busy="true"><div className="h-72 animate-pulse rounded-2xl bg-bg-2" /><div className="h-72 animate-pulse rounded-2xl bg-bg-2" /></div>
      : query.isError ? <p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p>
      : query.data.environments.length === 0 ? <p className="rounded-xl bg-bg-1 px-4 py-6 text-center text-sm text-t3">Nessun abbonamento né pagamento registrato.</p>
      : <div className="grid gap-4 xl:grid-cols-2">{query.data.environments.map((e) => <EnvironmentBlock key={`${e.environment}-${e.currency}`} e={e} />)}</div>}
    <p className="mt-4 text-xs leading-relaxed text-t4">Dati verificati dagli avvisi di Paddle (rivenditore e Merchant of Record): il pagato è la vendita di Paddle al cliente, il netto è quanto Paddle riconosce a KlokShift dopo IVA e commissioni. Payout, cioè i bonifici di Paddle, e costi non sono ancora collegati. Non è un risultato fiscale.</p>
  </Card>;
}

function MonthButton({ label, icon, disabled, onClick }: { label: string; icon: "chevronLeft" | "chevronRight"; disabled?: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    className="focus-gold grid size-8 cursor-pointer place-items-center rounded-lg text-t2 transition hover:bg-bg-3 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-30">
    <Icon name={icon} className="size-4" />
  </button>;
}

/** Scheda azienda: abbonamento, MRR e ultimi pagamenti di quell'azienda. */
export function WorkspaceFinancePanel({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const query = useAdminRead(userId, "workspace-finance", workspaceId, () => getAdminWorkspaceFinance(workspaceId));
  const title = "Abbonamento e pagamenti";
  if (query.isPending || query.isFetching) return <CardSkeleton title={title} rows={2} />;
  if (query.isError) return <Card><SectionHeader title={title} icon="euro" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  return <Card>
    <SectionHeader title={title} icon="euro" />
    {d.subscriptions.length === 0 ? <p className="text-sm text-t3">Nessun abbonamento Paddle: MRR e incassi pari a zero.</p>
      : <ul className="space-y-2">{d.subscriptions.map((s) => <li key={`${s.environment}-${s.created_at}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg-1 px-4 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{s.plan === "base" ? "Base" : "Team"} · {s.billing_interval === "year" ? "annuale" : "mensile"} · {1 + s.extra_venues} {s.extra_venues === 0 ? "sede" : "sedi"}</span>
              <span className="inline-flex items-center gap-1.5 text-t3"><Dot tone={subscriptionTone[s.status]} />{statusLabels[s.status]}{s.scheduled_change === "cancel" ? ", in chiusura" : s.scheduled_change === "pause" ? ", pausa programmata" : ""}</span>
              {s.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
            </p>
            <p className="mt-0.5 text-xs text-t3">ricorrente {formatMoney(s.recurring_cents, s.currency)} {s.billing_interval === "year" ? "all’anno" : "al mese"} IVA esclusa{s.current_period_ends_at ? ` · periodo fino al ${date(s.current_period_ends_at)}` : ""}</p>
          </div>
          <div className="text-right"><p className="text-xs text-t4">MRR</p><p className="font-serif text-xl tabular-nums text-gold">{formatMoney(s.mrr_cents, s.currency)}</p></div>
        </li>)}</ul>}
    {d.payments.length > 0 ? <ul className="mt-4 divide-y divide-border text-sm">{d.payments.map((p, i) => <li key={`${p.billed_at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
        <span className="text-t2">{date(p.billed_at)} · {originLabels[p.origin ?? ""] ?? "Pagamento"}{p.environment === "sandbox" ? " (sandbox)" : ""}</span>
        <span className="font-mono tabular-nums">{formatMoney(p.gross_cents, p.currency ?? "EUR")} <span className="font-sans text-xs text-t4">netto {formatMoney(p.earnings_cents, p.currency ?? "EUR")}</span></span>
      </li>)}</ul> : null}
    {d.refunds.length > 0 ? <p className="mt-3 text-sm text-t3">Rimborsi e contestazioni: {d.refunds.length}. Il dettaglio è in «Rimborsi e contestazioni».</p> : null}
    <p className="mt-3 text-xs text-t4">Costi per azienda non disponibili: non sono ancora collegati.</p>
  </Card>;
}
