import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { applyWorkspaceAction, getWorkspaceControl, getAccountControl, setAccountClassification, listOperations } from "@/features/admin/controls";
import type { AccountCommand, AdminClassification, WorkspaceCommand } from "@/features/admin/controls";
import { classifications } from "@/features/admin/types";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card, Field, Input, Select, Spinner, Textarea } from "../ui/primitives";

const labels = { customer: "Cliente", internal: "Interno", test: "Test", unclassified: "Non classificato" };
const actionLabels = { grant_lifetime: "Gratuità a vita / variazione capacità", set_classification: "Classificazione", add_note: "Nota amministrativa" };
function date(value: string) { return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value)); }
function ClassificationOptions() {
  return <>{classifications.map((c) => <option key={c} value={c}>{labels[c]}</option>)}</>;
}
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
  const [plan, setPlan] = useState<"base" | "team">("team");
  const [venues, setVenues] = useState("1");
  const [quota, setQuota] = useState("2048");
  const [classification, setClassification] = useState<AdminClassification>("unclassified");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<WorkspaceCommand | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const snapshot = query.data?.snapshot;
  function prepare() {
    setError(null); setSuccess(false);
    if (!query.data || !reason.trim()) { setError(new Error("admin_reason_required")); return; }
    const venueLimit = Number(venues);
    const documentLimitBytes = Number(quota) * 1048576;
    if (action === "grant_lifetime" && (!Number.isSafeInteger(venueLimit) || venueLimit < 1 ||
      !Number.isSafeInteger(Number(quota)) || !Number.isSafeInteger(documentLimitBytes) || documentLimitBytes < 1)) {
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
      setReview(null); setReason(""); setSuccess(true);
    } catch (e) { setError(e); }
  }
  return <Card><h2 className="mb-3 font-semibold">Interventi del fondatore</h2>
    <Feedback error={error ?? query.error} success={success} />
    {query.isPending || query.isFetching ? <Spinner /> : !query.isSuccess ? <Button onClick={() => void query.refetch()}>Riprova lettura</Button> : <>
      <p className="mb-4 text-sm text-t3">Classificazione: {labels[snapshot!.classification]}. Gratuità corrente: {snapshot!.lifetime ? `${snapshot!.lifetime.plan === "base" ? "Base" : "Team"} · ${snapshot!.lifetime.venue_limit} sedi · quota documenti ${snapshot!.lifetime.document_limit_bytes == null ? "non dichiarata" : snapshot!.lifetime.document_limit_bytes / 1048576 + " MiB"}` : "nessuna concessione permanente attiva"}.</p>
      {review ? <div className="space-y-4 rounded-xl border border-gold/30 p-4">
        <h3 className="font-semibold">Conferma: {actionLabels[review.change.action]}</h3>
        {review.change.action === "grant_lifetime" ? <>
          <p className="text-sm">Questa azienda riceve {review.change.plan === "base" ? "Base, fino a 30 persone" : "Team, persone senza limite commerciale"}, {review.change.venueLimit} sedi gratuite totali e {review.change.documentLimitBytes / 1048576} MiB di documenti dichiarati.</p>
          <p className="text-sm text-t3">Decorrenza alla conferma sul server, senza scadenza commerciale, carta o rinnovi. L’eventuale concessione precedente resta nello storico con la sua fine. Le altre aziende dello stesso titolare mantengono i propri diritti.</p>
          <p className="text-sm text-t3">La quota documenti viene registrata: il blocco degli upload al suo raggiungimento non è ancora attivo.</p>
        </> : review.change.action === "set_classification" ?
          <p className="text-sm">Nuova etichetta: {labels[review.change.classification]}. Accesso, prova e piano rimangono quelli attuali.</p> :
          <p className="text-sm">La nota viene aggiunta al registro senza modificare diritti o scadenze.</p>}
        <p className="whitespace-pre-wrap text-sm">Motivo: {review.reason}</p>
        <p className="text-xs text-t4">Il server verifica nuovamente capacità e dati correnti prima di applicare l’intervento.</p>
        <div className="flex flex-wrap gap-2"><Button variant="gold" disabled={mutation.isPending} onClick={() => void confirm()}>{mutation.isPending ? "Salvataggio…" : error ? "Riprova conferma" : "Conferma intervento"}</Button>
          <Button disabled={mutation.isPending} onClick={() => { setReview(null); setError(null); }}>Torna ai campi</Button></div>
      </div> : <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); prepare(); }}>
        <Field label="Intervento"><Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        {action === "grant_lifetime" ? <>
          <div className="grid gap-4 sm:grid-cols-3"><Field label="Piano concesso"><Select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}><option value="base">Base · fino a 30 persone</option><option value="team">Team · senza limite persone</option></Select></Field>
            <Field label="Sedi gratuite totali"><Input type="number" min={1} max={2147483647} step={1} required value={venues} onChange={(e) => setVenues(e.target.value)} /></Field>
            <Field label="Quota documenti (MiB)" hint="2048 MiB = 2 GiB. Quota dichiarata, da calibrare sui test."><Input type="number" min={1} step={1} required value={quota} onChange={(e) => setQuota(e.target.value)} /></Field></div>
          <p className="text-sm text-t3">Uso attuale: {snapshot!.access?.usage?.people ?? "non disponibile"} persone, {snapshot!.access?.usage?.venues ?? "non disponibile"} sedi aperte; {snapshot!.document_known_bytes / 1048576} MiB noti, {snapshot!.document_unknown_sizes} dimensioni da verificare.</p>
        </> : action === "set_classification" ? <Field label="Nuova classificazione"><Select value={classification} onChange={(e) => setClassification(e.target.value as AdminClassification)}><ClassificationOptions /></Select></Field> : null}
        <Reason value={reason} onChange={setReason} />
        <Button type="submit" variant="gold" disabled={!reason.trim() || mutation.isPending}>Rivedi intervento</Button>
      </form>}
    </>}
  </Card>;
}

export function AccountClassification({ userId, accountId }: { userId: string; accountId: string }) {
  const query = useAdminRead(userId, "account-control", accountId, () => getAccountControl(accountId));
  const mutation = useAdminWrite(setAccountClassification);
  const [classification, setClassification] = useState<AdminClassification>("unclassified");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<AccountCommand | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  async function confirm() {
    if (!review || mutation.isPending) return;
    setError(null);
    try { await mutation.mutateAsync(review); setReview(null); setReason(""); setSuccess(true); }
    catch (e) { setError(e); }
  }
  return <Card><h2 className="mb-3 font-semibold">Classificazione account</h2><Feedback error={error ?? query.error} success={success} />
    {query.isPending || query.isFetching ? <Spinner /> : !query.isSuccess ? <Button onClick={() => void query.refetch()}>Riprova lettura</Button> :
      review ? <div className="space-y-3"><p>Nuova etichetta: {labels[review.classification]}.</p><p className="text-sm text-t3">Non cambia le appartenenze, i permessi, l’accesso del fondatore o i piani aziendali.</p><p className="whitespace-pre-wrap text-sm">Motivo: {review.reason}</p>
        <div className="flex gap-2"><Button variant="gold" disabled={mutation.isPending} onClick={() => void confirm()}>{mutation.isPending ? "Salvataggio…" : error ? "Riprova conferma" : "Conferma classificazione"}</Button><Button disabled={mutation.isPending} onClick={() => { setReview(null); setError(null); }}>Torna ai campi</Button></div></div> :
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!query.data || !reason.trim()) return; setError(null); setSuccess(false); setReview({ accountId, operationId: crypto.randomUUID(), revision: query.data.revision, classification, reason: reason.trim() }); }}>
        <p className="text-sm text-t3">Classificazione attuale: {labels[query.data.classification]}.</p>
        <Field label="Nuova classificazione"><Select value={classification} onChange={(e) => setClassification(e.target.value as AdminClassification)}><ClassificationOptions /></Select></Field>
        <Reason value={reason} onChange={setReason} /><Button type="submit" variant="gold" disabled={!reason.trim()}>Rivedi classificazione</Button>
      </form>}
  </Card>;
}

export function OperationHistory({ userId, kind, targetId }: { userId: string; kind: "workspace" | "account"; targetId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "operations", { kind, targetId, offset }, () => listOperations(kind, targetId, offset));
  return <Card><h2 className="mb-3 font-semibold">Registro amministrativo</h2>
    {query.isPending || query.isFetching ? <Spinner /> : query.isError ? <><Feedback error={query.error} success={false} /><Button onClick={() => void query.refetch()}>Riprova</Button></> : <>
      {!query.data.items.length && <p className="text-sm text-t3">Nessun intervento in questa pagina.</p>}
      <ol className="divide-y divide-border-2">{query.data.items.map((op) => <li key={op.operation_id} className="space-y-2 py-4">
        <p className="text-sm font-semibold">{actionLabels[op.action]} · {date(op.applied_at)}</p>
        <p className="whitespace-pre-wrap text-sm">{op.reason}</p>
        {op.action === "set_classification" && <p className="text-sm text-t3">{labels[op.before_state.classification ?? "unclassified"]} → {labels[op.after_state.classification ?? "unclassified"]}</p>}
        {op.action === "grant_lifetime" && <p className="text-sm text-t3">Prima: {op.before_state.access?.plan ?? "piano non assegnato"}, {op.before_state.access?.limits.venues ?? "capacità da verificare"} sedi. Dopo: {op.after_state.lifetime?.plan === "base" ? "Base" : "Team"}, {op.after_state.lifetime?.venue_limit} sedi, {(op.after_state.lifetime?.document_limit_bytes ?? 0) / 1048576} MiB concessi.</p>}
        <p className="break-all text-xs text-t4"><Link className="text-gold" to={`/amministrazione/account/${op.actor_id}`}>Account attore</Link> · {op.actor_id}<br />Intervento: {op.operation_id}</p>
      </li>)}</ol>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-t3"><span>{query.data.total} interventi</span>
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Precedenti</Button>
        <Button disabled={offset + 25 >= query.data.total} onClick={() => setOffset(offset + 25)}>Successivi</Button></div>
    </>}
  </Card>;
}
