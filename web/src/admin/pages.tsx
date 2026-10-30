import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { useAdminRead } from "@/features/admin/hooks";
import { getAdminOverview, listAdminWorkspaces, getAdminWorkspace, listAdminAccounts, getAdminAccount } from "@/features/admin/api";
import { accountStates, classifications, workspaceStates } from "@/features/admin/types";
import type { AccountFilters, AdminFlag, AdminWorkspace, WorkspaceFilters } from "@/features/admin/types";
import { userErrorMessage as errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Input, PageHeader, Placeholder, Select } from "../ui/primitives";
import { WorkspaceActions, AccountClassification, OperationHistory } from "./WorkspaceActions";
import { BillingAdjustments } from "./BillingAdjustments";
import { RejectedEvents } from "./RejectedEvents";
import { CustomerDeletion, ExpiredArchives } from "./ExpiredArchives";
import { Activation } from "./Activation";
import { FinanceOverview, WorkspaceFinancePanel } from "./Finance";
import { bytes, date, day, flagLabels, labels, relative, severityTone, stateTone } from "./format";
import type { Tone } from "./format";
import {
  AllClear, BarList, Chip, Dot, Facts, FlagItem, FlagList, Footnote, Icon, IconBadge, Meter,
  Monogram, Pager, SectionHeader, SnapshotChip, StatPart, StatTile, StateBadge, Timeline, TimelineItem,
} from "./ui";
import type { IconName } from "./ui";

const workspaceLink = (id: string) => `/amministrazione/aziende/${id}`;
const accountLink = (id: string) => `/amministrazione/account/${id}`;

/**
 * Lettura con i tre stati. Durante una nuova lettura i dati vecchi spariscono
 * (scelta di M05: non si mostra niente che il server non abbia appena verificato).
 */
function Read<T>({ query, skeleton, children }: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending || query.isFetching)
    return skeleton ?? <ListLoading />;
  if (query.isError)
    return <Placeholder title="Dati non disponibili" detail={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Riprova</Button>} />;
  return children(query.data);
}
function ListLoading({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2" aria-busy="true">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-card" />)}
    <span className="sr-only">Caricamento…</span>
  </div>;
}
function OverviewLoading() {
  return <div className="space-y-6" aria-busy="true">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-bg-card" />)}</div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><div className="h-80 animate-pulse rounded-2xl bg-bg-card" /><div className="h-80 animate-pulse rounded-2xl bg-bg-card" /></div>
    <span className="sr-only">Caricamento…</span>
  </div>;
}

function filterOptions(values: readonly string[]) {
  return ['all', ...values].map((v) => <option key={v} value={v}>{labels[v] ?? v}</option>);
}

/** Barra composta a segmenti separati da 2px: quote di un totale. */
function StackBar({ parts }: { parts: { key: string; value: number; tone: Tone; label: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return null;
  const fill: Record<Tone, string> = { neutral: "bg-t4", gold: "bg-gold", success: "bg-success", warning: "bg-warning", error: "bg-error" };
  return <div className="mt-4 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" role="img"
    aria-label={parts.filter((p) => p.value).map((p) => `${p.label}: ${p.value}`).join(", ")}>
    {parts.filter((p) => p.value > 0).map((p) => <div key={p.key} title={`${p.label}: ${p.value}`} className={cn("h-full", fill[p.tone])} style={{ width: `${(p.value / total) * 100}%` }} />)}
  </div>;
}

// ── Panoramica ────────────────────────────────────────────────────────────

export function OverviewPage({ userId }: {
  userId: string;
}) {
  const query = useAdminRead(userId, 'overview', null, getAdminOverview);
  return <>
    <Read query={query} skeleton={<><PageHeader title="Panoramica" subtitle="Come vanno le aziende e cosa aspetta te" /><OverviewLoading /></>}>{(d) => {
      const states = workspaceStates.map((s) => ({ key: s, label: labels[s], value: d.workspaces.states[s] ?? 0, tone: stateTone[s] ?? "neutral" }));
      return <div className="space-y-8">
        <PageHeader title="Panoramica" subtitle="Come vanno le aziende e cosa aspetta te" actions={<SnapshotChip at={d.generated_at} />} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon="building" label="Aziende" value={d.workspaces.total}>
            {states.filter((s) => s.value > 0).slice(0, 3).map((s) => <StatPart key={s.key} tone={s.tone} value={s.value} label={s.label.toLowerCase()} />)}
            <StackBar parts={states} />
          </StatTile>
          <StatTile icon="user" label="Account Auth presenti" value={d.accounts.total}>
            <StatPart tone="success" value={d.accounts.confirmed} label="confermati" />
            <StatPart tone="warning" value={d.accounts.unconfirmed} label="da confermare" />
            <StatPart value={d.accounts.anonymous} label="anonimi" />
          </StatTile>
          <StatTile icon="venue" label="Sedi aperte" value={d.usage.open_venues}>
            <StatPart value={d.usage.closed_venues} label="chiuse" />
            <StatPart tone="gold" value={d.usage.current_placements} label="collocazioni" />
          </StatTile>
          <StatTile icon="file" label="Documenti Storage" value={<span className="text-3xl">{bytes(d.documents.known_bytes)}</span>}>
            <StatPart value={d.documents.files} label="oggetti" />
            {d.documents.unknown_sizes ? <StatPart tone="warning" value={d.documents.unknown_sizes} label="senza dimensione" /> : null}
            {d.documents.unattributed_files ? <StatPart tone="warning" value={d.documents.unattributed_files} label="non attribuiti" /> : null}
          </StatTile>
        </div>

        <section aria-label="Incassi" className="space-y-3">
          <GroupTitle icon="euro" title="Incassi" detail="Abbonamenti e pagamenti verificati da Paddle." />
          <FinanceOverview userId={userId} />
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-8">
            <section aria-label="Da fare" className="space-y-3">
              <GroupTitle icon="inbox" title="Da fare" detail="Controlli che aspettano te; quelli senza voci restano chiusi." />
              {d.signals.length ? <Card>
                <SectionHeader title="Segnalazioni da verificare" icon="alert" count={d.signals.length}
                  tone={d.signals.some((s) => s.severity === "critical") ? "error" : "warning"} />
                <ul className="space-y-2">{d.signals.map((s) => <FlagItem key={`${s.workspace_id}-${s.code}`} flag={s} workspace={{ id: s.workspace_id, name: s.workspace_name }} />)}</ul>
                <Footnote className="mt-4">Prime 20 segnalazioni, ordinate per gravità e scadenza. L’elenco aziende mostra anche le altre. Nessuna modifica automatica dei diritti.</Footnote>
              </Card> : <AllClear icon="alert" title="Segnalazioni da verificare">Nessuna segnalazione disponibile.</AllClear>}
              <BillingAdjustments userId={userId} />
              <RejectedEvents userId={userId} />
              <ExpiredArchives userId={userId} />
            </section>

            <section aria-label="Attivazione" className="space-y-3">
              <GroupTitle icon="activity" title="Attivazione" detail="Dove si fermano le aziende, dalla sede alla prima conferma." />
              <Activation userId={userId} />
            </section>
          </div>

          <aside aria-label="Composizione" className="min-w-0 space-y-3">
            <GroupTitle icon="activity" title="Composizione" detail="Come sono fatte le aziende oggi." />
            <Card>
              <h2 className="mb-4 font-semibold">Stati aziendali</h2>
              <BarList items={states.filter((s) => s.value > 0)} />
            </Card>
            <Card>
              <h2 className="mb-4 font-semibold">Classificazione esplicita</h2>
              <BarList items={classifications.map((c) => ({ key: c, label: labels[c], value: d.workspaces.classifications[c] ?? 0 })).filter((c) => c.value > 0)} />
              <Footnote className="mt-4">La gratuità non identifica un’azienda interna o test.</Footnote>
            </Card>
            <Card>
              <h2 className="mb-4 font-semibold">Origine accesso operativo</h2>
              <BarList items={Object.entries(d.workspaces.operational_sources).map(([s, n]) => ({ key: s, label: labels[s] ?? s, value: n }))} />
              <Footnote className="mt-4">Fonte: periodi commerciali verificati dal server.</Footnote>
            </Card>
            <Card>
              <h2 className="mb-4 font-semibold">Organico e appartenenze</h2>
              <dl className="grid grid-cols-2 gap-2">
                {([
                  ["Membri attivi", d.usage.active_members], ["Invitati", d.usage.invited_members],
                  ["Usciti", d.usage.left_members], ["Senza account", d.usage.unlinked_members],
                  ["Gestori attivi", d.usage.managers], ["Collocazioni", d.usage.current_placements],
                ] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-bg-1 px-3 py-2.5">
                  <dt className="text-xs text-t3">{label}</dt><dd className="mt-0.5 font-serif text-xl tabular-nums">{value}</dd>
                </div>)}
              </dl>
              <p className="mt-3 text-sm text-t2"><span className="font-semibold tabular-nums text-t1">{d.usage.commercial_people}</span> persone conteggiate commercialmente</p>
              <Footnote className="mt-2">Sommate per azienda: una persona presente in due aziende conta in ciascuna. Gli account Auth restano unici. Account eliminati ancora registrati: {d.accounts.deleted_available}; le cancellazioni definitive non sono ricostruibili senza un registro.</Footnote>
            </Card>
          </aside>
        </div>

        <details className="group rounded-2xl border border-border-2 bg-bg-card px-5 py-4 text-sm">
          <summary className="focus-gold cursor-pointer list-none font-semibold text-t2 marker:hidden">
            <span className="inline-flex items-center gap-2"><Icon name="help" className="size-4" />Come leggere questi numeri</span>
          </summary>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-t3">
            <li><strong className="text-t2">Aziende:</strong> tutte le aziende, comprese interne, test e archiviate.</li>
            <li><strong className="text-t2">Account Auth:</strong> {d.accounts.confirmed} confermati · {d.accounts.unconfirmed} da confermare · {d.accounts.anonymous} anonimi (sottoinsieme).</li>
            <li><strong className="text-t2">Sedi:</strong> conteggio tecnico delle sedi, distinto dalla capacità concessa.</li>
            <li><strong className="text-t2">Documenti:</strong> {d.documents.files} oggetti · {d.documents.unknown_sizes} dimensioni sconosciute · {d.documents.unattributed_files} non attribuiti. Byte noti da metadata.size; non è il costo.</li>
          </ul>
        </details>
      </div>;
    }}</Read>
  </>;
}

function GroupTitle({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return <div className="flex items-center gap-3 px-1">
    <Icon name={icon} className="size-4 text-gold" />
    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-t2">{title}</h2>
    <span className="hidden truncate text-xs text-t4 sm:inline">{detail}</span>
  </div>;
}

// ── Elenchi ───────────────────────────────────────────────────────────────

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}>
    <span className="relative block">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-t4" />
      <Input className="pl-9" maxLength={120} value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  </Field>;
}

function FilterBar({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return <form className="mb-6 rounded-2xl border border-border-2 bg-bg-card p-4" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(auto-fit,minmax(150px,1fr))]">{children}</div>
  </form>;
}

/** Riga cliccabile per intero: il link del nome si estende con `after:inset-0`. */
const rowLink = "focus-gold rounded font-semibold text-t1 after:absolute after:inset-0 after:content-[''] hover:text-gold";
const rowClass = "relative grid gap-x-6 gap-y-3 rounded-xl border border-border-2 bg-bg-card px-4 py-3.5 transition hover:border-border-gold hover:bg-bg-1";

function ListHead({ columns, className }: { columns: string[]; className: string }) {
  return <div aria-hidden className={cn("mb-2 hidden gap-x-6 px-4 text-[11px] font-semibold uppercase tracking-wider text-t4 lg:grid", className)}>
    {columns.map((c) => <span key={c}>{c}</span>)}
  </div>;
}

function FlagChips({ flags }: { flags: AdminFlag[] }) {
  if (!flags.length) return null;
  const [first, second, ...rest] = flags;
  return <div className="mt-1.5 flex flex-wrap gap-1">
    {[first, second].filter(Boolean).map((f) => <Chip key={f.code} tone={severityTone[f.severity]} icon="alert" title={`Fonte: ${f.source}`}>{flagLabels[f.code]}</Chip>)}
    {rest.length ? <Chip title={rest.map((f) => flagLabels[f.code]).join("\n")}>+{rest.length}</Chip> : null}
  </div>;
}

const workspaceColumns = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)]";

export function WorkspacesPage({ userId }: {
  userId: string;
}) {
  const [draft, setDraft] = useState<WorkspaceFilters>({ query: '', state: 'all', plan: 'all', classification: 'all', offset: 0 });
  const [filters, setFilters] = useState(draft);
  const query = useAdminRead(userId, 'workspaces', filters, () => listAdminWorkspaces(filters));
  return <><PageHeader title="Aziende" subtitle="Ricerca per nome azienda, gestore o email del gestore" actions={query.data && !query.isFetching ? <SnapshotChip at={query.data.generated_at} /> : null} />
    <FilterBar onSubmit={() => setFilters({ ...draft, offset: 0 })}>
      <SearchField label="Ricerca" value={draft.query} onChange={(q) => setDraft({ ...draft, query: q })} />
      <Field label="Stato"><Select value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value as WorkspaceFilters['state'] })}>{filterOptions(workspaceStates)}</Select></Field>
      <Field label="Piano"><Select value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value as WorkspaceFilters['plan'] })}>{filterOptions(['base', 'team'])}</Select></Field>
      <Field label="Classificazione"><Select value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value as WorkspaceFilters['classification'] })}>{filterOptions(classifications)}</Select></Field>
      <Button type="submit" variant="gold"><Icon name="search" className="size-4" />Cerca</Button>
    </FilterBar>
    <Read query={query}>{(d) => <>{d.items.length ? <>
      <p className="mb-3 text-sm text-t3">{d.total} {d.total === 1 ? 'azienda' : 'aziende'}</p>
      <ListHead className={workspaceColumns} columns={['Azienda', 'Stato e origine', 'Capacità', 'Gestori / membri', 'Documenti']} />
      <ul className="space-y-2">{d.items.map((w) => <li key={w.id} className={cn(rowClass, workspaceColumns)}>
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={w.name} size={38} />
          <div className="min-w-0">
            <Link to={workspaceLink(w.id)} className={rowLink}>{w.name}</Link>
            <p className="mt-0.5 text-xs text-t4">{labels[w.classification]} · dal {day(w.created_at)}</p>
          </div>
        </div>
        <div className="min-w-0">
          <StateBadge state={w.state} />
          <p className="mt-0.5 text-xs text-t3">{w.access?.source ? labels[w.access.source] : 'Origine non assegnata'}{w.access?.plan ? ` · ${labels[w.access.plan]}` : ''}</p>
          <FlagChips flags={w.flags} />
        </div>
        <CapacityMeters w={w} />
        <div className="text-sm text-t2">
          <p><span className="font-semibold tabular-nums text-t1">{w.managers}</span> gestori</p>
          <p className="text-xs text-t3">{w.active_members} attivi · {w.invited_members} invitati</p>
        </div>
        <div className="min-w-0">
          <Meter label="Spazio" used={w.document_known_bytes} limit={w.document_limit_bytes} missing="—" format={bytes} />
          <p className="mt-1 text-xs text-t4">{w.document_files} file{w.document_unknown_sizes ? ` · ${w.document_unknown_sizes} dimensioni sconosciute` : ''}</p>
        </div>
      </li>)}</ul></> : <Placeholder title="Nessuna azienda trovata" detail="Prova a modificare i filtri." />}<Pager page={d} onOffset={(offset) => setFilters({ ...filters, offset })} /></>}</Read>
  </>;
}

function CapacityMeters({ w }: { w: AdminWorkspace }) {
  const a = w.access;
  const missing = a === null ? 'Non disponibile' : 'Non assegnato';
  return <div className="min-w-0 space-y-2">
    <Meter label="Persone" used={a?.usage?.people} limit={a?.limits.people} unlimited={a?.plan === 'team'} missing={missing} />
    <Meter label="Sedi" used={w.open_venues} limit={a?.limits.venues} missing={missing} />
  </div>;
}

/** I test leggono `dt`/`dd` adiacenti e senza attributi: lo stile sta sul `dl`. */
function Capacity({ w }: {
  w: AdminWorkspace;
}) {
  const a = w.access;
  const missing = a === null ? 'Non disponibile' : 'Non assegnato';
  return <dl className="grid grid-cols-[auto_1fr] text-sm [&>dd]:pl-4 [&>dd]:border-b [&>dd]:border-border [&>dd]:py-2 [&>dd]:text-right [&>dd]:font-semibold [&>dd]:tabular-nums [&>dt]:border-b [&>dt]:border-border [&>dt]:py-2 [&>dt]:text-t3">
    <dt>Piano attuale</dt><dd>{a?.plan ? labels[a.plan] : missing}</dd>
    <dt>Persone in azienda</dt><dd>{a?.usage?.people ?? 'Conteggio non disponibile'}</dd>
    <dt>Limite persone</dt><dd>{a?.plan === 'team' ? 'Senza limite' : a?.limits.people ?? missing}</dd>
    <dt>Sedi aperte</dt><dd>{w.open_venues}</dd>
    <dt>Sedi consentite</dt><dd>{a?.limits.venues ?? missing}</dd>
  </dl>;
}

// ── Scheda azienda ────────────────────────────────────────────────────────

const workspaceTabs = [
  { id: 'riepilogo', label: 'Riepilogo', icon: 'overview' },
  { id: 'persone', label: 'Persone e sedi', icon: 'staff' },
  { id: 'gestione', label: 'Gestione', icon: 'settings' },
  { id: 'cronologia', label: 'Cronologia', icon: 'history' },
] as const;

export function WorkspacePage({ userId }: {
  userId: string;
}) {
  const { id = '' } = useParams();
  return <WorkspaceDetail key={id} userId={userId} id={id} />;
}

function Breadcrumb({ to, parent, current }: { to: string; parent: string; current?: string }) {
  return <nav aria-label="Percorso" className="mb-4 flex items-center gap-1.5 text-sm text-t3">
    <Link to={to} className="focus-gold rounded hover:text-gold">{parent}</Link>
    {current ? <><Icon name="chevronRight" className="size-3.5 text-t4" /><span className="truncate text-t2">{current}</span></> : null}
  </nav>;
}

/** Le date dell'accesso in fila, con «oggi» al suo posto. */
function Lifecycle({ a }: { a: NonNullable<AdminWorkspace["access"]> }) {
  // Fermo al montaggio: la scheda è una lettura, non un orologio.
  const [now] = useState(Date.now);
  const dates: [string, string | null][] = [
    ['Decorrenza', a.operational_from],
    ['Rettifiche consentite fino al', a.attendance_until],
    ['Fine operatività', a.operational_until],
    ['Archivio consultabile fino al', a.archive_until],
  ];
  const points = dates.flatMap(([label, at]) => at ? [{ label, at, t: Date.parse(at) }] : []);
  const openEnded = a.source === 'complimentary_lifetime' && a.operational_until === null;
  if (!points.length && !openEnded) return null;
  const items: { label: string; value: string; title?: string; kind: 'past' | 'future' | 'today' | 'open' }[] = [];
  let placedToday = false;
  for (const p of [...points].sort((x, y) => x.t - y.t)) {
    if (!placedToday && p.t > now) { items.push({ label: 'Oggi', value: day(new Date(now).toISOString()), kind: 'today' }); placedToday = true; }
    items.push({ label: p.label, value: day(p.at), title: date(p.at), kind: p.t > now ? 'future' : 'past' });
  }
  if (openEnded) items.push({ label: 'Fine operatività', value: 'Gratuità senza scadenza commerciale', kind: 'open' });
  else if (!placedToday) items.push({ label: 'Oggi', value: day(new Date(now).toISOString()), kind: 'today' });
  return <ol aria-label="Date dell’accesso" className="mt-6 grid gap-4 border-t border-border-2 pt-5 sm:grid-flow-col sm:auto-cols-fr">
    {items.map((i, n) => <li key={`${i.label}-${n}`} className="relative" title={i.title}>
      <div className="flex items-center gap-2">
        <span className={cn("size-2.5 shrink-0 rounded-full",
          i.kind === 'past' ? 'bg-gold' : i.kind === 'today' ? 'bg-success shadow-[0_0_0_4px] shadow-success/20' : i.kind === 'open' ? 'border-2 border-dashed border-gold' : 'border-2 border-t4')} />
        {n < items.length - 1 ? <span aria-hidden className={cn("hidden h-px flex-1 sm:block", i.kind === 'past' ? 'bg-gold/50' : 'bg-border-2')} /> : null}
      </div>
      <p className={cn("mt-2 text-xs", i.kind === 'today' ? 'font-semibold text-success' : 'text-t3')}>{i.label}</p>
      <p className="text-sm text-t1">{i.value}</p>
    </li>)}
  </ol>;
}

function WorkspaceHero({ w }: { w: AdminWorkspace }) {
  const a = w.access;
  const missing = a === null ? 'Non disponibile' : 'Non assegnato';
  return <header aria-label="Testata azienda" className="mb-6 rounded-2xl border border-border-2 bg-linear-to-br from-bg-card to-bg-1 p-6">
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex min-w-0 items-center gap-4">
        <Monogram name={w.name} size={60} />
        <div className="min-w-0">
          <h1 className="wrap-break-word font-serif text-3xl leading-tight text-t1">{w.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StateBadge state={w.state} />
            {a?.plan ? <Chip tone="gold">{labels[a.plan]}</Chip> : null}
            <Chip>{labels[w.classification]}</Chip>
            <span className="text-xs text-t4">Accesso: {a?.source ? labels[a.source] : 'Da assegnare'}</span>
          </div>
        </div>
      </div>
      <div className="grid w-full gap-3 sm:w-72">
        <Meter label="Persone" used={a?.usage?.people} limit={a?.limits.people} unlimited={a?.plan === 'team'} missing={missing} />
        <Meter label="Sedi aperte" used={w.open_venues} limit={a?.limits.venues} missing={missing} />
        <Meter label="Documenti" used={w.document_known_bytes} limit={w.document_limit_bytes} missing="—" format={bytes} />
      </div>
    </div>
    {a ? <Lifecycle a={a} /> : null}
  </header>;
}

function WorkspaceDetail({ userId, id }: { userId: string; id: string }) {
  const [params] = useSearchParams();
  const tab = workspaceTabs.find((t) => t.id === params.get('scheda'))?.id ?? 'riepilogo';
  const [offsets, setOffsets] = useState({ members: 0, venues: 0, periods: 0 });
  const [now] = useState(Date.now);
  const query = useAdminRead(userId, 'workspace', { id, ...offsets }, () => getAdminWorkspace(id, offsets));
  if (query.isPending || query.isError) return <><Breadcrumb to="/amministrazione/aziende" parent="Aziende" /><Read query={query} skeleton={<ListLoading rows={4} />}>{() => null}</Read></>;
  const d = query.data;
  return <>
    <Breadcrumb to="/amministrazione/aziende" parent="Aziende" current={d.workspace.name} />
    <WorkspaceHero w={d.workspace} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border-2">
      <nav aria-label="Schede azienda" className="-mb-px flex gap-1 overflow-x-auto">
        {workspaceTabs.map((t) => {
          const next = new URLSearchParams(params);
          next.set('scheda', t.id);
          return <Link key={t.id} to={{ search: next.toString() }} aria-current={tab === t.id ? 'page' : undefined}
            className={cn('focus-gold flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition', tab === t.id ? 'border-gold text-gold' : 'border-transparent text-t3 hover:text-t1')}><Icon name={t.icon} className="size-4" />{t.label}</Link>;
        })}
      </nav>
      <div className="pb-2"><SnapshotChip at={d.generated_at} /></div>
    </div>
    <section aria-label="Riepilogo" hidden={tab !== 'riepilogo'} className="space-y-6">
      {query.isFetching ? <ListLoading rows={3} /> : <>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><SectionHeader title="Piano e capacità attuali" icon="plan" /><Capacity w={d.workspace} />
            {d.workspace.state === 'migration_pending' && <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">Azienda creata prima dei nuovi piani. Le capacità commerciali attendono una tua assegnazione nella scheda Gestione.</p>}
          </Card>
          <Card><SectionHeader title="Segnalazioni e documenti" icon="alert" count={d.workspace.flags.length || undefined}
            tone={d.workspace.flags.some((f) => f.severity === 'critical') ? 'error' : 'warning'} />
            <FlagList flags={d.workspace.flags} />
            <div className="mt-5 rounded-xl bg-bg-1 p-4">
              <Meter label="Documenti" used={d.workspace.document_known_bytes} limit={d.workspace.document_limit_bytes} missing="quota non dichiarata" format={bytes} />
              <p className="mt-2 text-xs text-t3">{d.workspace.document_files} oggetti · {d.workspace.document_unknown_sizes} dimensioni sconosciute.</p>
              <Footnote className="mt-1">Misura aggregata dello spazio occupato.</Footnote>
            </div>
          </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><SectionHeader title="Attività recente" icon="activity" />
            <ul className="divide-y divide-border">
              {([
                ['planning', 'Ultimo turno creato', d.activity.last_shift_created_at],
                ['hours', 'Ultima timbratura d’ingresso', d.activity.last_clock_in_at],
                ['user', 'Ultimo login di un gestore', d.activity.last_manager_sign_in_at],
              ] as const).map(([icon, label, at]) => <li key={label} className="flex items-center gap-3 py-2.5">
                <IconBadge icon={icon} tone="neutral" className="size-8" />
                <span className="flex-1 text-sm text-t2">{label}</span>
                <span className="text-right text-sm text-t1" title={date(at)}>{at ? relative(at) : 'Non disponibile'}<span className="block text-xs text-t4">{at ? date(at) : ''}</span></span>
              </li>)}
            </ul>
            <Footnote className="mt-2">Il login è dell’account, anche se effettuato per un’altra azienda.</Footnote>
          </Card>
          <Card><SectionHeader title={`Classificazione: ${labels[d.workspace.classification]}`} icon="tag" />
            <p className="text-sm text-t3">Etichetta organizzativa dell’azienda. Piano e gratuità si assegnano separatamente nella scheda Gestione.</p>
            {d.classification_reason && <blockquote className="mt-4 border-l-2 border-gold/50 pl-3 text-sm text-t2">Motivo: {d.classification_reason}</blockquote>}
          </Card>
        </div>
        <WorkspaceFinancePanel userId={userId} workspaceId={id} />
        <BillingAdjustments userId={userId} workspaceId={id} />
      </>}
    </section>
    <section aria-label="Persone e sedi" hidden={tab !== 'persone'} className="space-y-6">
      {query.isFetching ? <ListLoading rows={3} /> : <>
        <Card><SectionHeader title="Membri aziendali" icon="staff" count={d.members.total || undefined} tone="neutral" />
          <ul className="divide-y divide-border">{d.members.items.map((m) => <li key={m.id} className="grid items-center gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-center gap-3"><Monogram name={m.display_name} size={32} /><span className="truncate font-medium">{m.display_name}</span></div>
            <div className="min-w-0 text-sm">{m.user_id ? <Link className="focus-gold rounded text-gold hover:underline" to={accountLink(m.user_id)}>{m.email ?? 'Account collegato'}</Link> : <><span className="text-t2">{m.email ?? 'Senza email'}</span><p className="text-xs text-t4">Scheda senza account collegato</p></>}</div>
            <div className="flex flex-wrap items-center gap-2"><Chip tone={m.authority === 'owner' ? 'gold' : 'neutral'}>{labels[m.authority]}</Chip><StateBadge state={m.status} /></div>
            <span className={cn("inline-flex items-center gap-1.5 text-xs", m.counts_as_person ? 'text-t2' : 'text-t4')}>
              {m.counts_as_person ? <Icon name="check" className="size-3.5 text-success" /> : <Dot tone="neutral" />}{m.counts_as_person ? 'Conteggiata' : 'Non conteggiata'}
            </span>
          </li>)}</ul>
          {!d.members.items.length && <p className="py-3 text-sm text-t3">Nessun membro in questa pagina.</p>}
          <Pager page={d.members} onOffset={(members) => setOffsets({ ...offsets, members })} />
        </Card>
        <Card><SectionHeader title="Sedi" icon="venue" count={d.venues.total || undefined} tone="neutral" />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{d.venues.items.map((v) => <li key={v.id} className="rounded-xl border border-border-2 bg-bg-1 p-4">
            <div className="flex items-start justify-between gap-2"><p className="font-semibold">{v.name}</p>{v.closed_at ? <Chip>Chiusa</Chip> : <Chip tone="success">Aperta</Chip>}</div>
            <p className="mt-3 font-serif text-2xl tabular-nums">{v.current_placements}</p>
            <p className="text-xs text-t3">persone collocate{v.closed_at ? ` · chiusa: ${date(v.closed_at)}` : ''}</p>
          </li>)}</ul>
          {!d.venues.items.length && <p className="py-3 text-sm text-t3">Nessuna sede in questa pagina.</p>}
          <Pager page={d.venues} onOffset={(venues) => setOffsets({ ...offsets, venues })} />
        </Card>
      </>}
    </section>
    <section aria-label="Gestione" hidden={tab !== 'gestione'} className="space-y-6">
      {d.workspace.deleted_at === null ? <WorkspaceActions key={id} userId={userId} workspaceId={id} /> : <Placeholder title="Azienda eliminata" detail="Il registro degli interventi è disponibile nella scheda Cronologia." />}
      {d.workspace.deleted_at === null && d.workspace.state !== 'operational'
        ? <CustomerDeletion key={`delete-${id}`} workspaceId={id} workspaceName={d.workspace.name} /> : null}
    </section>
    <section aria-label="Cronologia" hidden={tab !== 'cronologia'} className="grid gap-6 lg:grid-cols-2">
      {query.isFetching ? <ListLoading rows={3} /> : <Card><SectionHeader title="Storico dei piani e delle concessioni" icon="plan" />
        {d.periods.items.length ? <Timeline>{d.periods.items.map((p) => <TimelineItem key={p.id} tone={p.revoked_at ? 'neutral' : p.ends_at && Date.parse(p.ends_at) < now ? 'neutral' : 'gold'}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{labels[p.kind]}</span>
            <Chip tone="gold">{labels[p.plan]}</Chip>
            <Chip>{p.venue_limit} {p.venue_limit === 1 ? 'sede' : 'sedi'}</Chip>
            {p.revoked_at ? <Chip tone="error">Revocata {day(p.revoked_at)}</Chip> : null}
          </div>
          <p className="mt-1 text-xs text-t3">{date(p.starts_at)} → {p.ends_at ? date(p.ends_at) : 'Senza scadenza'}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-t2">{p.reason}</p>
        </TimelineItem>)}</Timeline> : <p className="text-sm text-t3">Nessun piano o concessione assegnati.</p>}
        <Pager page={d.periods} onOffset={(periods) => setOffsets({ ...offsets, periods })} />
      </Card>}
      <OperationHistory key={`history-${id}`} userId={userId} kind="workspace" targetId={id} />
    </section>
  </>;
}

// ── Account ───────────────────────────────────────────────────────────────

const accountColumns = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)]";

export function AccountsPage({ userId }: {
  userId: string;
}) {
  const [draft, setDraft] = useState<AccountFilters>({ query: '', status: 'all', classification: 'all', offset: 0 });
  const [filters, setFilters] = useState(draft);
  const query = useAdminRead(userId, 'accounts', filters, () => listAdminAccounts(filters));
  return <><PageHeader title="Account" subtitle="Account reali di Supabase Auth; le schede manuali sono nei dettagli aziendali" actions={query.data && !query.isFetching ? <SnapshotChip at={query.data.generated_at} /> : null} />
    <FilterBar onSubmit={() => setFilters({ ...draft, offset: 0 })}>
      <SearchField label="Nome o email" value={draft.query} onChange={(q) => setDraft({ ...draft, query: q })} />
      <Field label="Stato"><Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AccountFilters['status'] })}>{filterOptions(accountStates)}</Select></Field>
      <Field label="Classificazione"><Select value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value as AccountFilters['classification'] })}>{filterOptions(classifications)}</Select></Field>
      <Button type="submit" variant="gold"><Icon name="search" className="size-4" />Cerca</Button>
    </FilterBar>
    <Read query={query}>{(d) => <>{d.items.length ? <>
      <p className="mb-3 text-sm text-t3">{d.total} account</p>
      <ListHead className={accountColumns} columns={['Account', 'Stato / classificazione', 'Registrazione / login', 'Appartenenze']} />
      <ul className="space-y-2">{d.items.map((a) => <li key={a.id} className={cn(rowClass, accountColumns)}>
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={a.full_name || a.email || '?'} size={38} />
          <div className="min-w-0">
            <Link className={rowLink} to={accountLink(a.id)}>{a.full_name || a.email || 'Account senza nome'}</Link>
            <p className="truncate text-xs text-t3">{a.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><StateBadge state={a.status} /><Chip>{labels[a.classification]}</Chip></div>
        <div className="text-sm">
          <p className="text-t2" title={date(a.created_at)}>Registrato {a.created_at ? relative(a.created_at) : '—'}</p>
          <p className="text-xs text-t3" title={date(a.last_sign_in_at)}>Login: {a.last_sign_in_at ? relative(a.last_sign_in_at) : 'mai'}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={a.active_memberships ? 'success' : 'neutral'}>{a.active_memberships} attive</Chip>
          {a.invited_memberships ? <Chip tone="gold">{a.invited_memberships} invitate</Chip> : null}
          {a.left_memberships ? <Chip>{a.left_memberships} terminate</Chip> : null}
        </div>
      </li>)}</ul></> : <Placeholder title="Nessun account trovato" />}<Pager page={d} onOffset={(offset) => setFilters({ ...filters, offset })} /></>}</Read>
  </>;
}

export function AccountPage({ userId }: {
  userId: string;
}) {
  const { id = '' } = useParams();
  return <AccountDetail key={id} userId={userId} id={id} />;
}

function AccountDetail({ userId, id }: { userId: string; id: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, 'account', { id, offset }, () => getAdminAccount(id, offset));
  return <>
    <Breadcrumb to="/amministrazione/account" parent="Account" current={query.data && !query.isFetching ? query.data.account.full_name || query.data.account.email || 'Account' : undefined} />
    <Read query={query} skeleton={<ListLoading rows={4} />}>{(d) => <div className="space-y-6">
      <header aria-label="Testata account" className="rounded-2xl border border-border-2 bg-linear-to-br from-bg-card to-bg-1 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Monogram name={d.account.full_name || d.account.email || '?'} size={60} />
            <div className="min-w-0">
              <h1 className="wrap-break-word font-serif text-3xl leading-tight">{d.account.full_name || d.account.email || 'Account'}</h1>
              <p className="mt-1 truncate text-sm text-t3">{d.account.email ?? 'Email non disponibile'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><StateBadge state={d.account.status} /><Chip>{labels[d.account.classification]}</Chip></div>
            </div>
          </div>
          <SnapshotChip at={d.generated_at} />
        </div>
        <div className="mt-6">
          <Facts items={[
            { label: 'Registrazione', value: date(d.account.created_at) },
            { label: 'Conferma email', value: date(d.account.email_confirmed_at) },
            { label: 'Ultimo login', value: <>{date(d.account.last_sign_in_at)}{d.account.last_sign_in_at ? <span className="block text-xs text-t4">{relative(d.account.last_sign_in_at)}</span> : null}</> },
            { label: 'Eliminazione registrata', value: date(d.account.deleted_at) },
          ]} />
          <p className="mt-4 text-sm text-t3">Motivo classificazione: {d.classification_reason ?? 'Nessuna classificazione assegnata'}</p>
        </div>
      </header>
      <Card><SectionHeader title="Appartenenze, gestione e lavoro" icon="building" count={d.memberships.total || undefined} tone="neutral" />
        <ul className="grid gap-3 xl:grid-cols-2">{d.memberships.items.map((m) => <li key={m.id} className="rounded-xl border border-border-2 bg-bg-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <Monogram name={m.workspace_name} size={34} />
              <div className="min-w-0">
                <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={workspaceLink(m.workspace_id)}>{m.workspace_name}</Link>
                <p className="text-xs text-t3">{m.display_name}{m.workspace_deleted_at ? ' · azienda eliminata' : ''}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2"><Chip tone={m.authority === 'owner' ? 'gold' : 'neutral'}>{labels[m.authority]}</Chip><StateBadge state={m.status} /></div>
          </div>
          <p className="mt-2 text-xs text-t4">Ambito: {m.scope === 'all' ? 'tutte le sedi' : 'selezionate'}{m.status === 'left' ? ' (appartenenza terminata)' : ''}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <VenueChips title="Sedi gestite" total={m.managed_venues_total} more="Consulta le sedi nel dettaglio azienda."
              items={m.managed_venues.map((v) => ({ key: v.id, label: `${v.name}${v.closed_at ? ' · chiusa' : ''}`, muted: !!v.closed_at }))} />
            <VenueChips title="Sedi di lavoro" total={m.works_total} more="Consulta il dettaglio azienda per il contesto completo."
              items={m.works.map((v, i) => ({ key: `${v.venue_id}-${i}`, label: `${v.venue_name}${v.left_at ? ' · collocazione terminata' : ' · attuale'}${v.closed_at ? ' · sede chiusa' : ''}`, muted: !!v.left_at || !!v.closed_at }))} />
          </div>
        </li>)}</ul>
        {!d.memberships.items.length && <p className="py-3 text-sm text-t3">Nessuna appartenenza in questa pagina.</p>}
        <Pager page={d.memberships} onOffset={setOffset} />
      </Card>
    </div>}</Read>
    {query.isSuccess && <div className="mt-6 grid gap-6 lg:grid-cols-2"><AccountClassification key={id} userId={userId} accountId={id} /><OperationHistory key={`history-${id}`} userId={userId} kind="account" targetId={id} /></div>}
  </>;
}

function VenueChips({ title, items, total, more }: { title: string; items: { key: string; label: string; muted: boolean }[]; total: number; more: string }) {
  return <div>
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-t4">{title}</p>
    {total ? <div className="flex flex-wrap gap-1.5">{items.map((i) => <span key={i.key} className={cn("rounded-lg border border-border-2 px-2 py-1 text-xs", i.muted ? 'text-t4' : 'text-t2')}>{i.label}</span>)}</div>
      : <p className="text-sm text-t3">Nessuna</p>}
    {total > 25 && <p className="mt-1 text-xs text-t4">Prime 25 di {total}. {more}</p>}
  </div>;
}
