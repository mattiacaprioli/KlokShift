import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { useAdminRead } from "@/features/admin/hooks";
import { getAdminOverview, listAdminWorkspaces, getAdminWorkspace, listAdminAccounts, getAdminAccount } from "@/features/admin/api";
import { accountStates, classifications, workspaceStates } from "@/features/admin/types";
import type { AccountFilters, AdminFlag, AdminPage, AdminWorkspace, WorkspaceFilters } from "@/features/admin/types";
import { userErrorMessage as errorMessage } from "@/lib/errors";
import { Button, Card, Field, Input, PageHeader, Pill, Placeholder, Select, Spinner } from "../ui/primitives";
const labels: Record<string, string> = {
  all: 'Tutti', customer: 'Cliente', internal: 'Interno', test: 'Test', unclassified: 'Non classificato',
  setup: 'Preparazione', operational: 'Operativa', archive: 'Archivio', expired: 'Archivio scaduto', migration_pending: 'Migrazione da verificare', unavailable: 'Dati mancanti', deleted: 'Eliminato',
  confirmed: 'Confermato', unconfirmed: 'Da confermare', anonymous: 'Anonimo', owner: 'Titolare', collaborator: 'Collaboratore', none: 'Professionista', active: 'Attivo', invited: 'Invitato', left: 'Uscito',
  base: 'Base', team: 'Team', trial: 'Prova', complimentary_lifetime: 'Gratuito a vita', complimentary_temporary: 'Concessione temporanea', transition: 'Transizione',
};
const flagLabels: Record<AdminFlag['code'], string> = {
  migration_pending: 'Verificare la migrazione commerciale', commercial_data_missing: 'Verificare i dati commerciali mancanti', trial_ending: 'Prova in scadenza entro 7 giorni', archive_ending: 'Archivio in scadenza entro 30 giorni', attendance_window: 'Rettifiche pregresse ancora consentite', archive_expired: 'Archivio scaduto: verificare il percorso di cancellazione', people_near_capacity: 'Capacità persone prossima al limite', people_over_capacity: 'Capacità persone superata', venues_over_capacity: 'Capacità sedi superata', document_measurement_incomplete: 'Dimensioni Storage incomplete',
};
function date(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(value)) : 'Non disponibile'; }
function bytes(value: number) { return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value / 1048576) + ' MiB'; }
const workspaceLink = (id: string) => `/amministrazione/aziende/${id}`;
const accountLink = (id: string) => `/amministrazione/account/${id}`;
function Snapshot({ at }: {
  at: string;
}) { return <p className="mb-5 text-xs text-t4">Dati verificati dal server: {date(at)} · orario Europe/Rome. Usa Aggiorna per una nuova lettura.</p>; }
function Read<T>({ query, children }: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending || query.isFetching)
    return <Spinner />;
  if (query.isError)
    return <Placeholder title="Dati non disponibili" detail={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Riprova</Button>} />;
  return children(query.data);
}
function Pager({ page, onOffset }: {
  page: AdminPage;
  onOffset: (n: number) => void;
}) {
  return <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-t3"><span>{page.total === 0 ? 'Nessun risultato' : page.offset >= page.total ? `Pagina vuota · ${page.total} risultati totali` : `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} di ${page.total}`}</span><Button disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - page.limit))}>Precedenti</Button><Button disabled={page.offset + page.limit >= page.total} onClick={() => onOffset(page.offset + page.limit)}>Successivi</Button></div>;
}
function Table({ headers, children }: {
  headers: string[];
  children: ReactNode;
}) { return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border-2 text-xs text-t3"><tr>{headers.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-border-2">{children}</tbody></table></div>; }
function Cell({ children }: {
  children: ReactNode;
}) { return <td className="p-3 align-top">{children}</td>; }
function Metric({ title, value, detail }: {
  title: string;
  value: ReactNode;
  detail: string;
}) { return <Card><p className="text-sm text-t3">{title}</p><p className="my-2 font-serif text-2xl">{value}</p><p className="text-xs text-t4">{detail}</p></Card>; }
function Options({ values }: {
  values: readonly string[];
}) { return <>{['all', ...values].map((v) => <option key={v} value={v}>{labels[v] ?? v}</option>)}</>; }
function FinancialUnavailable() { return <Card><h2 className="font-semibold">Economia e costi</h2><p className="mt-2 text-sm text-t3">Non disponibili. Il registro finanziario, gli incassi Paddle e le fonti di costo non sono ancora collegati. I conteggi operativi non rappresentano clienti paganti, ricavi o utile.</p></Card>; }
function Flags({ flags }: {
  flags: AdminFlag[];
}) { return flags.length ? <ul className="space-y-3">{flags.map((f) => <li key={f.code}><Pill tone={f.severity === 'critical' ? 'error' : f.severity === 'warning' ? 'warning' : 'neutral'}>{flagLabels[f.code]}</Pill><p className="mt-1 text-xs text-t4">Fonte: {f.source}{f.at ? ` · ${date(f.at)}` : ''}</p></li>)}</ul> : <p className="text-sm text-t3">Nessuna anomalia fra i controlli disponibili.</p>; }
export function OverviewPage({ userId }: {
  userId: string;
}) {
  const query = useAdminRead(userId, 'overview', null, getAdminOverview);
  return <><PageHeader title="Panoramica" subtitle="Account, aziende e consumo misurato" /><Read query={query}>{(d) => <div className="space-y-6"><Snapshot at={d.generated_at} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric title="Aziende" value={d.workspaces.total} detail="Tutte le aziende, comprese interne, test e archiviate." />
      <Metric title="Account Auth presenti" value={d.accounts.total} detail={`${d.accounts.confirmed} confermati · ${d.accounts.unconfirmed} da confermare · ${d.accounts.anonymous} anonimi (sottoinsieme).`} />
      <Metric title="Sedi aperte / chiuse" value={`${d.usage.open_venues} / ${d.usage.closed_venues}`} detail="Conteggio tecnico delle sedi, distinto dalla capacità concessa." />
      <Metric title="Documenti Storage" value={bytes(d.documents.known_bytes)} detail={`${d.documents.files} oggetti · ${d.documents.unknown_sizes} dimensioni sconosciute · ${d.documents.unattributed_files} non attribuiti. Byte noti da metadata.size; non è il costo.`} />
    </div>
    <div className="grid gap-4 md:grid-cols-3"><Card><h2 className="mb-3 font-semibold">Stati aziendali</h2>{Object.entries(d.workspaces.states).map(([s, n]) => <p key={s} className="text-sm text-t3">{labels[s]}: {n}</p>)}</Card>
      <Card><h2 className="mb-3 font-semibold">Classificazione esplicita</h2>{Object.entries(d.workspaces.classifications).map(([s, n]) => <p key={s} className="text-sm text-t3">{labels[s]}: {n}</p>)}<p className="mt-3 text-xs text-t4">La gratuità non identifica un’azienda interna o test.</p></Card>
      <Card><h2 className="mb-3 font-semibold">Origine accesso operativo</h2>{Object.entries(d.workspaces.operational_sources).map(([s, n]) => <p key={s} className="text-sm text-t3">{labels[s] ?? s}: {n}</p>)}<p className="mt-3 text-xs text-t4">Fonte: periodi commerciali verificati dal server.</p></Card>
    </div>
    <Card><h2 className="mb-3 font-semibold">Organico e appartenenze</h2><p className="text-sm text-t3">{d.usage.active_members} membri attivi · {d.usage.invited_members} invitati · {d.usage.left_members} usciti · {d.usage.unlinked_members} senza account collegato · {d.usage.managers} gestori attivi · {d.usage.current_placements} collocazioni attuali.</p><p className="mt-2 text-xs text-t4">{d.usage.commercial_people} persone conteggiate commercialmente, sommate per azienda: una persona presente in due aziende conta in ciascuna. Gli account Auth restano unici. Account eliminati ancora registrati: {d.accounts.deleted_available}; le cancellazioni definitive non sono ricostruibili senza un registro.</p></Card>
    <Card><h2 className="mb-4 font-semibold">Segnalazioni da verificare</h2>{d.signals.length ? <ul className="space-y-4">{d.signals.map((s) => <li key={`${s.workspace_id}-${s.code}`}><Link className="text-gold" to={workspaceLink(s.workspace_id)}>{s.workspace_name}</Link><Flags flags={[s]} /></li>)}</ul> : <p className="text-sm text-t3">Nessuna segnalazione disponibile.</p>}<p className="mt-4 text-xs text-t4">Prime 20 segnalazioni, ordinate per gravità e scadenza. L’elenco aziende mostra anche le altre. Nessuna modifica automatica dei diritti.</p></Card>
    <FinancialUnavailable />
  </div>}</Read></>;
}
export function WorkspacesPage({ userId }: {
  userId: string;
}) {
  const [draft, setDraft] = useState<WorkspaceFilters>({ query: '', state: 'all', plan: 'all', classification: 'all', offset: 0 });
  const [filters, setFilters] = useState(draft);
  const query = useAdminRead(userId, 'workspaces', filters, () => listAdminWorkspaces(filters));
  return <><PageHeader title="Aziende" subtitle="Ricerca per nome azienda, gestore o email del gestore" />
    <form className="mb-6 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft, offset: 0 }); }}>
      <Field label="Ricerca"><Input maxLength={120} value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} /></Field>
      <Field label="Stato"><Select value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value as WorkspaceFilters['state'] })}><Options values={workspaceStates} /></Select></Field>
      <Field label="Piano"><Select value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value as WorkspaceFilters['plan'] })}><Options values={['base', 'team']} /></Select></Field>
      <Field label="Classificazione"><Select value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value as WorkspaceFilters['classification'] })}><Options values={classifications} /></Select></Field>
      <Button type="submit" variant="gold">Cerca</Button>
    </form>
    <Read query={query}>{(d) => <><Snapshot at={d.generated_at} />{d.items.length ? <Table headers={['Azienda', 'Stato e origine', 'Capacità', 'Gestori / membri', 'Documenti']}>
      {d.items.map((w) => <tr key={w.id}><Cell><Link to={workspaceLink(w.id)} className="text-gold">{w.name}</Link><p className="text-xs text-t4">{labels[w.classification]} · {date(w.created_at)}</p></Cell><Cell>{labels[w.state]}<p className="text-xs text-t3">{w.access?.source ? labels[w.access.source] : 'Origine non assegnata'}</p><Flags flags={w.flags} /></Cell><Cell><Capacity w={w} /></Cell><Cell>{w.managers} gestori · {w.active_members} attivi · {w.invited_members} invitati</Cell><Cell>{bytes(w.document_known_bytes)}<p className="text-xs text-t4">{w.document_files} file · {w.document_unknown_sizes} dimensioni sconosciute</p></Cell></tr>)}
    </Table> : <Placeholder title="Nessuna azienda trovata" detail="Prova a modificare i filtri." />}<Pager page={d} onOffset={(offset) => setFilters({ ...filters, offset })} /></>}</Read>
  </>;
}
function Capacity({ w }: {
  w: AdminWorkspace;
}) {
  const a = w.access;
  return <div className="text-sm"><p>Piano: {a?.plan ? labels[a.plan] : 'Non assegnato'}</p><p>Persone: {a?.usage?.people ?? 'Non disponibili'} / {a?.plan === 'team' ? 'senza limite' : a?.limits.people ?? 'da verificare'}</p><p>Sedi aperte: {w.open_venues} / {a?.limits.venues ?? 'da verificare'}</p></div>;
}
export function WorkspacePage({ userId }: {
  userId: string;
}) {
  const { id = '' } = useParams();
  const [offsets, setOffsets] = useState({ members: 0, venues: 0, periods: 0 });
  const query = useAdminRead(userId, 'workspace', { id, ...offsets }, () => getAdminWorkspace(id, offsets));
  return <Read query={query}>{(d) => <div className="space-y-6">
    <PageHeader title={d.workspace.name} subtitle={`${labels[d.workspace.state]} · ${labels[d.workspace.classification]}`} actions={<Link to="/amministrazione/aziende" className="text-gold">Tutte le aziende</Link>} /><Snapshot at={d.generated_at} />
    <div className="grid gap-4 md:grid-cols-2"><Card><h2 className="mb-3 font-semibold">Accesso e capacità</h2><Capacity w={d.workspace} /><p className="mt-3 text-sm text-t3">Origine: {d.workspace.access?.source ? labels[d.workspace.access.source] : 'Non assegnata'}</p><p className="text-sm text-t3">Inizio: {date(d.workspace.access?.operational_from)}<br />Fine operatività: {d.workspace.access?.source === 'complimentary_lifetime' ? 'Senza scadenza commerciale' : date(d.workspace.access?.operational_until)}<br />Fine rettifiche: {date(d.workspace.access?.attendance_until)}<br />Fine archivio: {date(d.workspace.access?.archive_until)}</p><p className="mt-3 text-xs text-t4">Stato calcolato sui periodi aziendali. Motivo classificazione: {d.classification_reason ?? 'Nessuna classificazione assegnata'}.</p></Card>
      <Card><h2 className="mb-3 font-semibold">Segnalazioni</h2><Flags flags={d.workspace.flags} /><p className="mt-4 text-sm text-t3">Documenti: {bytes(d.workspace.document_known_bytes)} noti · {d.workspace.document_files} oggetti · {d.workspace.document_unknown_sizes} dimensioni sconosciute.</p><p className="mt-2 text-xs text-t4">Il fondatore vede soltanto la misura aggregata: nessun documento, percorso o contenuto HR.</p></Card></div>
    <Card><h2 className="mb-3 font-semibold">Attività osservabile</h2><p className="text-sm text-t3">Ultimo turno creato: {date(d.activity.last_shift_created_at)}<br />Ultima timbratura d’ingresso: {date(d.activity.last_clock_in_at)}<br />Ultimo login di un gestore: {date(d.activity.last_manager_sign_in_at)}</p><p className="mt-2 text-xs text-t4">Il login è dell’account, anche se effettuato per un’altra azienda. Queste date non misurano tutte le azioni o le sessioni attive.</p></Card>
    <Card><h2 className="mb-3 font-semibold">Membri aziendali</h2><Table headers={['Persona', 'Account', 'Authority / stato', 'Capacità persone']}>{d.members.items.map((m) => <tr key={m.id}><Cell>{m.display_name}</Cell><Cell>{m.user_id ? <Link className="text-gold" to={accountLink(m.user_id)}>{m.email ?? 'Account collegato'}</Link> : <>{m.email ?? 'Senza email'}<p className="text-xs text-t4">Scheda senza account collegato</p></>}</Cell><Cell>{labels[m.authority]} · {labels[m.status]}</Cell><Cell>{m.counts_as_person ? 'Conteggiata' : 'Non conteggiata'}</Cell></tr>)}</Table>{!d.members.items.length && <p className="p-3 text-sm text-t3">Nessun membro in questa pagina.</p>}<Pager page={d.members} onOffset={(members) => setOffsets({ ...offsets, members })} /></Card>
    <Card><h2 className="mb-3 font-semibold">Sedi</h2><Table headers={['Sede', 'Stato', 'Collocazioni attuali']}>{d.venues.items.map((v) => <tr key={v.id}><Cell>{v.name}</Cell><Cell>{v.closed_at ? `Chiusa: ${date(v.closed_at)}` : 'Aperta'}</Cell><Cell>{v.current_placements}</Cell></tr>)}</Table><Pager page={d.venues} onOffset={(venues) => setOffsets({ ...offsets, venues })} /></Card>
    <Card><h2 className="mb-3 font-semibold">Periodi commerciali</h2><Table headers={['Origine / capacità', 'Inizio / fine', 'Revoca', 'Motivo']}>{d.periods.items.map((p) => <tr key={p.id}><Cell>{labels[p.kind]} · {labels[p.plan]} · {p.venue_limit} sedi</Cell><Cell>{date(p.starts_at)}<br />{p.ends_at ? date(p.ends_at) : 'Senza scadenza'}</Cell><Cell>{p.revoked_at ? date(p.revoked_at) : 'Nessuna'}</Cell><Cell>{p.reason}</Cell></tr>)}</Table>{!d.periods.items.length && <p className="p-3 text-sm text-t3">Nessun periodo in questa pagina. Non assegniamo un piano di ripiego.</p>}<Pager page={d.periods} onOffset={(periods) => setOffsets({ ...offsets, periods })} /></Card>
    <FinancialUnavailable />
  </div>}</Read>;
}
export function AccountsPage({ userId }: {
  userId: string;
}) {
  const [draft, setDraft] = useState<AccountFilters>({ query: '', status: 'all', classification: 'all', offset: 0 });
  const [filters, setFilters] = useState(draft);
  const query = useAdminRead(userId, 'accounts', filters, () => listAdminAccounts(filters));
  return <><PageHeader title="Account" subtitle="Account reali di Supabase Auth; le schede manuali sono nei dettagli aziendali" />
    <form className="mb-6 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft, offset: 0 }); }}>
      <Field label="Nome o email"><Input maxLength={120} value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} /></Field>
      <Field label="Stato"><Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AccountFilters['status'] })}><Options values={accountStates} /></Select></Field>
      <Field label="Classificazione"><Select value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value as AccountFilters['classification'] })}><Options values={classifications} /></Select></Field><Button type="submit" variant="gold">Cerca</Button>
    </form>
    <Read query={query}>{(d) => <><Snapshot at={d.generated_at} />{d.items.length ? <Table headers={['Account', 'Stato / classificazione', 'Registrazione / login', 'Appartenenze']}>
      {d.items.map((a) => <tr key={a.id}><Cell><Link className="text-gold" to={accountLink(a.id)}>{a.full_name || a.email || 'Account senza nome'}</Link><p className="text-xs text-t3">{a.email}</p></Cell><Cell>{labels[a.status]} · {labels[a.classification]}</Cell><Cell>{date(a.created_at)}<p className="text-xs text-t3">Login: {date(a.last_sign_in_at)}</p></Cell><Cell>{a.active_memberships} attive · {a.invited_memberships} invitate · {a.left_memberships} terminate</Cell></tr>)}
    </Table> : <Placeholder title="Nessun account trovato" />}<Pager page={d} onOffset={(offset) => setFilters({ ...filters, offset })} /></>}</Read>
  </>;
}
export function AccountPage({ userId }: {
  userId: string;
}) {
  const { id = '' } = useParams();
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, 'account', { id, offset }, () => getAdminAccount(id, offset));
  return <Read query={query}>{(d) => <div className="space-y-6"><PageHeader title={d.account.full_name || d.account.email || 'Account'} subtitle={`${labels[d.account.status]} · ${labels[d.account.classification]}`} actions={<Link className="text-gold" to="/amministrazione/account">Tutti gli account</Link>} /><Snapshot at={d.generated_at} />
    <Card><p className="text-sm text-t3">Email: {d.account.email ?? 'Non disponibile'}<br />Registrazione: {date(d.account.created_at)}<br />Conferma email: {date(d.account.email_confirmed_at)}<br />Ultimo login: {date(d.account.last_sign_in_at)}<br />Eliminazione registrata: {date(d.account.deleted_at)}<br />Motivo classificazione: {d.classification_reason ?? 'Nessuna classificazione assegnata'}</p></Card>
    <Card><h2 className="mb-3 font-semibold">Appartenenze, gestione e lavoro</h2><Table headers={['Azienda / scheda', 'Authority / stato', 'Sedi gestite', 'Sedi di lavoro']}>{d.memberships.items.map((m) => <tr key={m.id}>
      <Cell><Link className="text-gold" to={workspaceLink(m.workspace_id)}>{m.workspace_name}</Link><p className="text-xs text-t3">{m.display_name}{m.workspace_deleted_at ? ' · azienda eliminata' : ''}</p></Cell>
      <Cell>{labels[m.authority]} · {labels[m.status]}<p className="text-xs text-t4">Ambito: {m.scope === 'all' ? 'tutte le sedi' : 'selezionate'}{m.status === 'left' ? ' (appartenenza terminata)' : ''}</p></Cell>
      <Cell>{m.managed_venues.map((v) => <p key={v.id}>{v.name}{v.closed_at ? ' · chiusa' : ''}</p>)}{!m.managed_venues_total && 'Nessuna'}{m.managed_venues_total > 25 && <p className="text-xs text-t4">Prime 25 di {m.managed_venues_total}. Consulta le sedi nel dettaglio azienda.</p>}</Cell>
      <Cell>{m.works.map((v, i) => <p key={`${v.venue_id}-${i}`}>{v.venue_name}{v.left_at ? ' · collocazione terminata' : ' · attuale'}{v.closed_at ? ' · sede chiusa' : ''}</p>)}{!m.works_total && 'Nessuna'}{m.works_total > 25 && <p className="text-xs text-t4">Prime 25 di {m.works_total}. Consulta il dettaglio azienda per il contesto completo.</p>}</Cell>
    </tr>)}</Table>{!d.memberships.items.length && <p className="p-3 text-sm text-t3">Nessuna appartenenza in questa pagina.</p>}<Pager page={d.memberships} onOffset={setOffset} /></Card>
  </div>}</Read>;
}
