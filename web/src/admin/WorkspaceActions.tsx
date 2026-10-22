import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { applyWorkspaceAction, getWorkspaceControl, getAccountControl, setAccountClassification, listOperations } from "@/features/admin/controls";
import type { AccountCommand, AccountControl, AdminClassification, WorkspaceCommand } from "@/features/admin/controls";
import { classifications } from "@/features/admin/types";
import { userErrorMessage } from "@/lib/errors";
import { date, mib } from "./format";
import { cn } from "@/lib/cn";
import { Button, Card, Field, Input, Select, Textarea } from "../ui/primitives";
import { Icon, IconBadge, Meter, SectionHeader, Timeline, TimelineItem } from "./ui";
import type { IconName } from "./ui";
import { confirmationFailure } from "./confirmation";

const labels = { customer: "Cliente", internal: "Interno", test: "Test", unclassified: "Non classificato" };
const actionLabels = { grant_lifetime: "Gratuità a vita / variazione capacità", set_classification: "Classificazione", add_note: "Nota amministrativa" };
// Il registro mostra anche la cancellazione dei dati, che non si prepara da questo modulo.
const historyLabels = { ...actionLabels, delete_data: "Cancellazione dei dati a fine archivio" };
// Select ricava il menu dai figli <option> diretti, senza eseguire componenti annidati.
const classificationOptions = classifications.map((c) => <option key={c} value={c}>{labels[c]}</option>);
function Reason({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="Motivo dell'intervento" hint="Obbligatorio, conservato nel registro amministrativo."><Textarea required maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function Feedback({ error, success }: { error: unknown; success: boolean }) {
  return <>{error != null && <p role="alert" className="my-3 text-sm text-error">{userErrorMessage(error)}</p>}
    {success && <p role="status" className="my-3 text-sm text-success">Intervento registrato. I dati sono stati aggiornati.</p>}</>;
}

export function WorkspaceActions({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const query = useAdminRead(userId, "workspace-control", workspaceId, () => getWorkspaceControl(workspaceId));
  const mutation = useAdminWrite(applyWorkspaceAction);
  const [action, setAction] = useState<WorkspaceCommand["change"]["action"]>("grant_lifetime");
  const [planDraft, setPlan] = useState<"base" | "team" | null>(null);
  const [venuesDraft, setVenues] = useState<string | null>(null);
  const [quotaDraft, setQuota] = useState<string | null>(null);
  const [classificationDraft, setClassification] = useState<AdminClassification | null>(null);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<WorkspaceCommand | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const snapshot = query.data?.snapshot;
  const plan = planDraft ?? snapshot?.lifetime?.plan ?? "team";
  const venues = venuesDraft ?? String(snapshot?.lifetime?.venue_limit ?? 1);
  const quota = quotaDraft ?? String(snapshot?.lifetime?.document_limit_bytes != null ? snapshot.lifetime.document_limit_bytes / 1048576 : 2048);
  const classification = classificationDraft ?? snapshot?.classification ?? "unclassified";
  function prepare() {
    setError(null); setSuccess(false);
    if (!query.data || !reason.trim()) { setError(new Error("admin_reason_required")); return; }
    const venueLimit = Number(venues);
    const documentLimitBytes = Number(quota) * 1048576;
    if (action === "grant_lifetime" && (!Number.isSafeInteger(venueLimit) || venueLimit < 1 ||
      !Number.isSafeInteger(documentLimitBytes) || documentLimitBytes < 1)) {
      setError(new Error("invalid_access_capacity")); return;
    }
    const change: WorkspaceCommand["change"] = action === "grant_lifetime" ?
      { action, plan, venueLimit, documentLimitBytes } : action === "set_classification" ? { action, classification } : { action };
    setReview({ workspaceId, operationId: crypto.randomUUID(), revision: query.data.revision, reason: reason.trim(), change });
  }
  async function confirm() {
    if (!review || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync(review);
      setReview(null); setReason(""); setPlan(null); setVenues(null); setQuota(null); setClassification(null); setSuccess(true);
    } catch (e) {
      const failure = confirmationFailure(e);
      setError(failure.error);
      if (!failure.retry) { setReview(null); void query.refetch(); }
    }
  }
  const lifetimeText = (l: NonNullable<typeof snapshot>["lifetime"]) => l
    ? `${l.plan === "base" ? "Base" : "Team"} · ${l.venue_limit} ${l.venue_limit === 1 ? "sede" : "sedi"} · documenti ${l.document_limit_bytes == null ? "quota non dichiarata" : mib(l.document_limit_bytes)}`
    : "Non assegnata";
  return <Card><SectionHeader title="Gestisci piano e classificazione" icon="settings" />
    <p className="-mt-2 mb-5 text-sm text-t3">Prepara un intervento per questa azienda. Le modifiche si applicano dopo aver rivisto il riepilogo e confermato.</p>
    <Feedback error={error ?? query.error} success={success} />
    {query.isPending || query.isFetching ? <div className="h-64 animate-pulse rounded-xl bg-bg-2" aria-busy="true" /> : !query.isSuccess ? <Button onClick={() => void query.refetch()}>Riprova lettura</Button> :
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
      <div className="h-fit space-y-4 rounded-xl border border-border-2 bg-bg-1 p-4">
        <h3 className="text-sm font-semibold">Situazione attuale</h3>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-xs text-t3">Classificazione</dt><dd className="mt-0.5 text-t1">{labels[snapshot!.classification]}.</dd></div>
          <div><dt className="text-xs text-t3">Gratuità a vita</dt><dd className="mt-0.5 text-t1">{lifetimeText(snapshot!.lifetime)}.</dd></div>
        </dl>
        <div className="space-y-3 border-t border-border-2 pt-4">
          <Meter label="Persone" used={snapshot!.access?.usage?.people} limit={snapshot!.access?.limits.people} unlimited={snapshot!.access?.plan === "team"} missing="non assegnato" />
          <Meter label="Sedi aperte" used={snapshot!.access?.usage?.venues} limit={snapshot!.access?.limits.venues} missing="non assegnato" />
        </div>
      </div>
      {review ? <div className="space-y-4 rounded-xl border border-gold/40 bg-gold/[0.04] p-5">
        <h3 className="flex items-center gap-2 font-semibold"><Icon name="shield" className="size-4 text-gold" />Modifica da confermare: {actionLabels[review.change.action]}</h3>
        {review.change.action !== "add_note" ? <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl bg-bg-1 p-3"><p className="text-xs text-t3">Prima</p><p className="mt-1 text-sm text-t2">{review.change.action === "grant_lifetime" ? lifetimeText(snapshot!.lifetime) : labels[snapshot!.classification]}</p></div>
          <Icon name="chevronRight" className="mx-auto size-5 rotate-90 text-gold sm:rotate-0" />
          <div className="rounded-xl border border-gold/40 bg-bg-1 p-3"><p className="text-xs text-gold">Dopo</p><p className="mt-1 text-sm font-semibold text-t1">{review.change.action === "grant_lifetime"
            ? lifetimeText({ period_id: "", plan: review.change.plan, venue_limit: review.change.venueLimit, document_limit_bytes: review.change.documentLimitBytes })
            : labels[review.change.classification]}</p></div>
        </div> : null}
        {review.change.action === "grant_lifetime" ? <>
          <p className="text-sm">Questa azienda riceve {review.change.plan === "base" ? "Base, fino a 30 persone" : "Team, persone senza limite commerciale"}, un totale di {review.change.venueLimit} {review.change.venueLimit === 1 ? "sede gratuita" : "sedi gratuite"} e {mib(review.change.documentLimitBytes)} di documenti dichiarati.</p>
          <p className="text-sm text-t3">Decorrenza alla conferma sul server, senza scadenza commerciale, carta o rinnovi. L’eventuale concessione precedente resta nello storico con la sua fine. Le altre aziende dello stesso titolare mantengono i propri diritti.</p>
          <p className="text-sm text-t3">La quota documenti viene registrata: il blocco degli upload al suo raggiungimento non è ancora attivo.</p>
        </> : review.change.action === "set_classification" ?
          <p className="text-sm">Nuova etichetta: {labels[review.change.classification]}. Accesso, prova e piano rimangono quelli attuali.</p> :
          <p className="text-sm">La nota viene aggiunta al registro senza modificare diritti o scadenze.</p>}
        <blockquote className="whitespace-pre-wrap border-l-2 border-gold/50 pl-3 text-sm">Motivo: {review.reason}</blockquote>
        <p className="text-xs text-t4">Il server verifica nuovamente capacità e dati correnti prima di applicare l’intervento.</p>
        <div className="flex flex-wrap gap-2"><Button variant="gold" disabled={mutation.isPending} onClick={() => void confirm()}><Icon name="check" className="size-4" />{mutation.isPending ? "Salvataggio…" : error ? "Riprova conferma" : "Conferma intervento"}</Button>
          <Button disabled={mutation.isPending} onClick={() => { setReview(null); setError(null); }}>Torna ai campi</Button></div>
      </div> : <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); prepare(); }}>
        <h3 className="text-sm font-semibold">Prepara una modifica</h3>
        <fieldset className="space-y-2">
          <legend className="mb-2"><StepLabel n={1}>Intervento</StepLabel></legend>
          <div className="grid gap-2 sm:grid-cols-3">{(Object.keys(actionLabels) as (keyof typeof actionLabels)[]).map((value) =>
            <RadioCard key={value} name="action" value={value} checked={action === value} onChange={() => setAction(value)}
              icon={actionIcons[value]} title={actionLabels[value]} detail={actionDetails[value]} />)}</div>
        </fieldset>
        {action === "grant_lifetime" ? <fieldset className="space-y-3">
          <legend className="mb-2"><StepLabel n={2}>Capacità da concedere</StepLabel></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <RadioCard name="plan" value="base" checked={plan === "base"} onChange={() => setPlan("base")} icon="staff" title="Base · fino a 30 persone" detail="Stesse funzioni, persone uniche limitate" />
            <RadioCard name="plan" value="team" checked={plan === "team"} onChange={() => setPlan("team")} icon="team" title="Team · senza limite persone" detail="Stesse funzioni, nessun limite di persone" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Sedi da concedere (totale)"><Input type="number" min={1} max={2147483647} step={1} required value={venues} onChange={(e) => setVenues(e.target.value)} /></Field>
            <Field label="Quota documenti da concedere (MiB)" hint="2048 MiB = 2 GiB. Quota dichiarata; limite sugli upload ancora da attivare."><Input type="number" min={0} step="any" required value={quota} onChange={(e) => setQuota(e.target.value)} /></Field></div>
          <p className="text-xs text-t3">Uso attuale: {snapshot!.access?.usage?.people ?? "non disponibile"} persone · sedi aperte: {snapshot!.access?.usage?.venues ?? "non disponibile"} · documenti: {mib(snapshot!.document_known_bytes)} noti, {snapshot!.document_unknown_sizes} dimensioni da verificare.</p>
        </fieldset> : action === "set_classification" ? <fieldset>
          <legend className="mb-2"><StepLabel n={2}>Etichetta</StepLabel></legend>
          <Field label="Nuova classificazione"><Select value={classification} onChange={(e) => setClassification(e.target.value as AdminClassification)}>{classificationOptions}</Select></Field>
        </fieldset> : null}
        <div>
          <div className="mb-2"><StepLabel n={action === "add_note" ? 2 : 3}>Perché lo fai</StepLabel></div>
          <Reason value={reason} onChange={setReason} />
        </div>
        <Button type="submit" variant="gold" disabled={!reason.trim() || mutation.isPending}>Rivedi intervento<Icon name="chevronRight" className="size-4" /></Button>
      </form>}
    </div>}
  </Card>;
}

const actionIcons = { grant_lifetime: "gift", set_classification: "tag", add_note: "note" } as const;
const actionDetails = {
  grant_lifetime: "Piano, sedi e quota documenti senza scadenza",
  set_classification: "Cliente, interno, test: non tocca i diritti",
  add_note: "Solo una riga nel registro",
};

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-t3">
    <span className="grid size-5 place-items-center rounded-full bg-gold/15 text-[11px] text-gold">{n}</span>{children}
  </span>;
}

function RadioCard({ name, value, checked, onChange, icon, title, detail }: {
  name: string; value: string; checked: boolean; onChange: () => void; icon: IconName; title: string; detail: string;
}) {
  return <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition focus-within:ring-2 focus-within:ring-gold/60",
    checked ? "border-gold bg-gold/[0.07]" : "border-border-2 bg-bg-1 hover:border-border-gold")}>
    <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
    <IconBadge icon={icon} tone={checked ? "gold" : "neutral"} className="size-8" />
    <span className="min-w-0"><span className={cn("block text-sm font-semibold", checked ? "text-gold" : "text-t1")}>{title}</span><span className="mt-0.5 block text-xs text-t3">{detail}</span></span>
  </label>;
}

export function useAccountClassificationDraft(accountId: string, control: AccountControl | undefined) {
  const [draft, setClassification] = useState<AdminClassification | null>(null);
  const classification = draft ?? control?.classification ?? "unclassified";
  function prepare(reason: string): AccountCommand | null {
    if (!control || !reason.trim()) return null;
    return {
      accountId, operationId: crypto.randomUUID(), revision: control.revision,
      classification, reason: reason.trim(),
    };
  }
  return { classification, setClassification, prepare };
}

export function AccountClassification({ userId, accountId }: { userId: string; accountId: string }) {
  const query = useAdminRead(userId, "account-control", accountId, () => getAccountControl(accountId));
  const mutation = useAdminWrite(setAccountClassification);
  const { classification, setClassification, prepare } = useAccountClassificationDraft(accountId, query.data);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<AccountCommand | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  async function confirm() {
    if (!review || mutation.isPending) return;
    setError(null);
    try { await mutation.mutateAsync(review); setReview(null); setReason(""); setClassification(null); setSuccess(true); }
    catch (e) {
      const failure = confirmationFailure(e);
      setError(failure.error);
      if (!failure.retry) { setReview(null); void query.refetch(); }
    }
  }
  return <Card><SectionHeader title="Classificazione account" icon="tag" /><Feedback error={error ?? query.error} success={success} />
    {query.isPending || query.isFetching ? <div className="h-40 animate-pulse rounded-xl bg-bg-2" aria-busy="true" /> : !query.isSuccess ? <Button onClick={() => void query.refetch()}>Riprova lettura</Button> :
      review ? <div className="space-y-3 rounded-xl border border-gold/40 bg-gold/[0.04] p-4"><p>Nuova etichetta: {labels[review.classification]}.</p><p className="text-sm text-t3">Non cambia le appartenenze, i permessi, l’accesso del fondatore o i piani aziendali.</p><blockquote className="whitespace-pre-wrap border-l-2 border-gold/50 pl-3 text-sm">Motivo: {review.reason}</blockquote>
        <div className="flex flex-wrap gap-2"><Button variant="gold" disabled={mutation.isPending} onClick={() => void confirm()}>{mutation.isPending ? "Salvataggio…" : error ? "Riprova conferma" : "Conferma classificazione"}</Button><Button disabled={mutation.isPending} onClick={() => { setReview(null); setError(null); }}>Torna ai campi</Button></div></div> :
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const command = prepare(reason); if (!command) return; setError(null); setSuccess(false); setReview(command); }}>
        <p className="text-sm text-t3">Classificazione attuale: <span className="font-semibold text-t1">{labels[query.data.classification]}</span>.</p>
        <Field label="Nuova classificazione"><Select value={classification} onChange={(e) => setClassification(e.target.value as AdminClassification)}>{classificationOptions}</Select></Field>
        <Reason value={reason} onChange={setReason} /><Button type="submit" variant="gold" disabled={!reason.trim()}>Rivedi classificazione</Button>
      </form>}
  </Card>;
}

export function OperationHistory({ userId, kind, targetId }: { userId: string; kind: "workspace" | "account"; targetId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "operations", { kind, targetId, offset }, () => listOperations(kind, targetId, offset));
  return <Card><SectionHeader title="Registro amministrativo" icon="history" count={query.data && !query.isFetching && query.data.total ? query.data.total : undefined} tone="neutral" />
    {query.isPending || query.isFetching ? <div className="h-32 animate-pulse rounded-xl bg-bg-2" aria-busy="true" /> : query.isError ? <><Feedback error={query.error} success={false} /><Button onClick={() => void query.refetch()}>Riprova</Button></> : <>
      {!query.data.items.length && <p className="text-sm text-t3">Nessun intervento in questa pagina.</p>}
      <Timeline>{query.data.items.map((op) => <TimelineItem key={op.operation_id} tone={op.action === "delete_data" ? "error" : op.action === "grant_lifetime" ? "gold" : "neutral"}>
        <p className="flex flex-wrap items-center gap-x-2 text-sm"><span className="font-semibold">{historyLabels[op.action]}</span><span className="text-xs text-t3">{date(op.applied_at)}</span></p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-t2">{op.reason}</p>
        {op.action === "set_classification" && <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs"><span className="rounded-md bg-bg-2 px-1.5 py-0.5 text-t3">{labels[op.before_state.classification ?? "unclassified"]}</span><Icon name="chevronRight" className="size-3 text-t4" /><span className="rounded-md bg-gold/12 px-1.5 py-0.5 text-gold">{labels[op.after_state.classification ?? "unclassified"]}</span></p>}
        {op.action === "grant_lifetime" && <p className="mt-1.5 text-xs text-t3">Prima: {op.before_state.access?.plan ?? "piano non assegnato"}, {op.before_state.access?.limits.venues ?? "capacità da verificare"} sedi. Dopo: {op.after_state.lifetime?.plan === "base" ? "Base" : "Team"}, {op.after_state.lifetime?.venue_limit} sedi, {(op.after_state.lifetime?.document_limit_bytes ?? 0) / 1048576} MiB concessi.</p>}
        <p className="mt-1.5 break-all text-[11px] text-t4"><Link className="text-gold hover:underline" to={`/amministrazione/account/${op.actor_id}`}>Account attore</Link> · <span className="font-mono">{op.actor_id}</span><br />Intervento: <span className="font-mono">{op.operation_id}</span></p>
      </TimelineItem>)}</Timeline>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-t3"><span>{query.data.total} interventi</span>
        {query.data.total > 25 ? <><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Precedenti</Button>
        <Button disabled={offset + 25 >= query.data.total} onClick={() => setOffset(offset + 25)}>Successivi</Button></> : null}</div>
    </>}
  </Card>;
}
