import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { listBillingAdjustments, resolveBillingAdjustment } from "@/features/admin/billing";
import type { BillingAdjustment } from "@/features/admin/billing";
import { userErrorMessage } from "@/lib/errors";
import { date } from "./format";
import { Button, Card, Field, Input, Pill } from "../ui/primitives";
import { ActionBox, AllClear, AttentionItem, CardSkeleton, Footnote, Icon, Pager, SectionHeader } from "./ui";

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
  if (query.isPending || query.isFetching) return <CardSkeleton title={title} rows={2} />;
  if (query.isError) return <Card><SectionHeader title={title} icon="euro" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  if (d.items.length === 0 && offset === 0) return <AllClear icon="euro" title={title}>
    {workspaceId ? "Nessun rimborso o contestazione per questa azienda." : "Niente da verificare: i rimborsi totali si applicano da soli e gli abbonamenti rimborsati risultano disdetti."}
  </AllClear>;
  return <Card>
    <SectionHeader title={title} icon="euro" count={d.open_total > 0 ? `${d.open_total} da verificare` : undefined} />
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessuna voce in questa pagina.</p>
      : <ul className="space-y-3">{d.items.map((a) => <AdjustmentItem key={`${a.environment}-${a.adjustment_id}`} a={a} showWorkspace={!workspaceId} />)}</ul>}
    <Pager page={d} onOffset={setOffset} />
    <Footnote className="mt-4">Eventi verificati da Paddle. Non sono incassi né rimborsi dell’economia: quelli arrivano con il registro finanziario.</Footnote>
  </Card>;
}

function AdjustmentItem({ a, showWorkspace }: { a: BillingAdjustment; showWorkspace: boolean }) {
  const [note, setNote] = useState("");
  const resolve = useAdminWrite(resolveBillingAdjustment);
  return <AttentionItem tone={a.attention ? (a.attention === "chargeback" ? "error" : "warning") : "neutral"}>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showWorkspace ? <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${a.workspace_id}`}>{a.workspace_name}</Link> : null}
      <span className="font-semibold">{actionLabels[a.action] ?? a.action} {amount(a)}</span>
      <span className="text-t3">· {a.transaction_origin ? originLabels[a.transaction_origin] ?? a.transaction_origin : "pagamento non nel registro"}</span>
      <Pill tone={a.status === "approved" ? "neutral" : a.status === "rejected" ? "success" : "warning"}>{statusLabels[a.status]}</Pill>
      {a.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
    </div>
    <p className="mt-1 text-xs text-t3">{date(a.created_at)} · {effectText(a)} Abbonamento {a.subscription_status === "canceled" ? "disdetto" : "aperto"} su Paddle (<span className="font-mono">{a.subscription_id}</span>).</p>
    {a.attention ? <ActionBox>
      <p className="flex items-start gap-2 text-sm text-t1"><Icon name="alert" className="mt-0.5 size-4 text-warning" />{attentionLabels[a.attention]}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        resolve.mutate({ environment: a.environment, adjustmentId: a.adjustment_id, note: note.trim() }, { onSuccess: () => setNote("") });
      }}>
        <div className="min-w-56 flex-1"><Field label="Cosa hai fatto"><Input required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <Button type="submit" variant="gold" disabled={resolve.isPending || note.trim().length < 3}><Icon name="check" className="size-4" />{resolve.isPending ? "Salvataggio…" : "Segna come verificato"}</Button>
      </form>
      {resolve.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(resolve.error)}</p> : null}
    </ActionBox> : a.reviewed_at ? <p className="mt-2 flex items-center gap-1.5 text-xs text-t3"><Icon name="check" className="size-3.5 text-success" />Verificato il {date(a.reviewed_at)}: {a.review_note}</p> : null}
  </AttentionItem>;
}
