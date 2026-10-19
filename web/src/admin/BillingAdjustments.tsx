import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { listBillingAdjustments, resolveBillingAdjustment } from "@/features/admin/billing";
import type { BillingAdjustment } from "@/features/admin/billing";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card, Field, Input, Pill, Spinner } from "../ui/primitives";

const attentionLabels: Record<NonNullable<BillingAdjustment["attention"]>, string> = {
  cancel_on_paddle: "Rimborso totale: l'accesso è chiuso, ma l'abbonamento è ancora aperto su Paddle. Disdicilo, altrimenti al rinnovo addebita di nuovo.",
  upgrade_refunded: "Aumento rimborsato: riduci piano o sedi su Paddle senza addebito. La capacità torna indietro quando arriva l'avviso.",
  chargeback: "Contestazione del cliente: segui la pratica su Paddle e decidi se chiudere l'accesso.",
  unknown_payment: "Rimborso di un pagamento che non risulta nel registro: verifica su Paddle a cosa si riferisce.",
  refund_reversed: "Paddle ha annullato un rimborso che aveva chiuso l'accesso: decidi se riaprirlo.",
  other: "Da verificare su Paddle.",
};
const actionLabels: Record<string, string> = {
  refund: "Rimborso", chargeback: "Contestazione", chargeback_warning: "Avviso di contestazione", credit: "Accredito",
};
const statusLabels: Record<BillingAdjustment["status"], string> = {
  pending_approval: "In attesa di Paddle", approved: "Approvato", rejected: "Rifiutato", reversed: "Annullato",
};
const originLabels: Record<string, string> = {
  api: "primo pagamento", web: "primo pagamento", subscription_recurring: "rinnovo", subscription_update: "aumento o sede",
};

function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value));
}
function amount(a: BillingAdjustment) {
  if (a.total_cents === null || !a.currency) return "Importo non disponibile";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: a.currency }).format(a.total_cents / 100);
}
function effectText(a: BillingAdjustment) {
  if (a.effect === "access_cut") return `Accesso chiuso il ${a.access_cut_at ? date(a.access_cut_at) : "giorno dell'approvazione"}.`;
  if (a.effect === "manual_review") return "Nessun effetto automatico sull'accesso.";
  if (a.effect === "none") return "Solo registrato: l'accesso pagato resta.";
  return "Ancora nessun effetto: Paddle non ha deciso.";
}

/** Rimborsi e contestazioni: da verificare (tutte le aziende) o lo storico di un'azienda. */
export function BillingAdjustments({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const [offset, setOffset] = useState(0);
  const filters = { workspaceId: workspaceId ?? null, openOnly: !workspaceId, offset };
  const query = useAdminRead(userId, "billing-adjustments", filters, () => listBillingAdjustments(filters));
  const title = workspaceId ? "Rimborsi e contestazioni" : "Pagamenti da verificare";
  if (query.isPending || query.isFetching) return <Card><h2 className="mb-3 font-semibold">{title}</h2><Spinner /></Card>;
  if (query.isError) return <Card><h2 className="mb-3 font-semibold">{title}</h2><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  return <Card>
    <div className="mb-3 flex flex-wrap items-center gap-3"><h2 className="font-semibold">{title}</h2>
      {d.open_total > 0 ? <Pill tone="warning">{d.open_total} da verificare</Pill> : null}</div>
    {d.items.length === 0
      ? <p className="text-sm text-t3">{workspaceId ? "Nessun rimborso o contestazione per questa azienda." : "Niente da verificare: i rimborsi totali si applicano da soli e gli abbonamenti rimborsati risultano disdetti."}</p>
      : <ul className="divide-y divide-border-2">{d.items.map((a) => <AdjustmentItem key={`${a.environment}-${a.adjustment_id}`} a={a} showWorkspace={!workspaceId} />)}</ul>}
    {d.total > d.limit ? <div className="mt-4 flex gap-3">
      <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - d.limit))}>Precedenti</Button>
      <Button disabled={offset + d.limit >= d.total} onClick={() => setOffset(offset + d.limit)}>Successivi</Button>
    </div> : null}
    <p className="mt-4 text-xs text-t4">Eventi verificati da Paddle. Non sono incassi né rimborsi dell’economia: quelli arrivano con il registro finanziario.</p>
  </Card>;
}

function AdjustmentItem({ a, showWorkspace }: { a: BillingAdjustment; showWorkspace: boolean }) {
  const [note, setNote] = useState("");
  const resolve = useAdminWrite(resolveBillingAdjustment);
  return <li className="py-4">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showWorkspace ? <Link className="font-semibold text-gold" to={`/amministrazione/aziende/${a.workspace_id}`}>{a.workspace_name}</Link> : null}
      <span className="font-semibold">{actionLabels[a.action] ?? a.action} {amount(a)}</span>
      <span className="text-t3">· {a.transaction_origin ? originLabels[a.transaction_origin] ?? a.transaction_origin : "pagamento non nel registro"}</span>
      <Pill tone={a.status === "approved" ? "neutral" : a.status === "rejected" ? "success" : "warning"}>{statusLabels[a.status]}</Pill>
      {a.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
    </div>
    <p className="mt-1 text-xs text-t3">{date(a.created_at)} · {effectText(a)} Abbonamento {a.subscription_status === "canceled" ? "disdetto" : "aperto"} su Paddle ({a.subscription_id}).</p>
    {a.attention ? <>
      <p className="mt-2 text-sm text-gold">{attentionLabels[a.attention]}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        resolve.mutate({ environment: a.environment, adjustmentId: a.adjustment_id, note: note.trim() }, { onSuccess: () => setNote("") });
      }}>
        <Field label="Cosa hai fatto"><Input required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button type="submit" disabled={resolve.isPending || note.trim().length < 3}>{resolve.isPending ? "Salvataggio…" : "Segna come verificato"}</Button>
      </form>
      {resolve.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(resolve.error)}</p> : null}
    </> : a.reviewed_at ? <p className="mt-2 text-xs text-t3">Verificato il {date(a.reviewed_at)}: {a.review_note}</p> : null}
  </li>;
}
