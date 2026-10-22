import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { listRejectedBillingEvents, resolveBillingEvent } from "@/features/admin/billing";
import type { RejectedBillingEvent } from "@/features/admin/billing";
import { userErrorMessage } from "@/lib/errors";
import { date } from "./format";
import { Button, Card, Field, Input, Pill } from "../ui/primitives";
import { ActionBox, AllClear, AttentionItem, CardSkeleton, Footnote, Icon, Pager, SectionHeader } from "./ui";

/** Il motivo dello scarto (`billing_apply_event`) e cosa fare, in italiano. */
const errorLabels: Record<string, string> = {
  duplicate_subscription: "Secondo abbonamento aperto per la stessa azienda: non è stato sommato. Rimborsalo e chiudilo su Paddle.",
  unlinked_subscription: "Abbonamento senza una richiesta d’acquisto della dashboard (creato fuori da KlokShift?): non dà accesso. Verifica su Paddle a chi appartiene.",
  unknown_price: "Prezzo non nel catalogo di KlokShift: l’abbonamento non è stato applicato. Va aggiunto al catalogo dei prezzi, poi riallineato.",
  invalid_plan_items: "Le voci dell’abbonamento non indicano un solo piano: non è stato applicato. Controllalo su Paddle.",
  mixed_billing_interval: "Voci con periodi diversi (mensile e annuale insieme): non è stato applicato.",
  unsupported_status: "Stato dell’abbonamento non gestito (per esempio una prova di Paddle): non è stato applicato.",
  unsupported_billing_cycle: "Ciclo di fatturazione non gestito: solo mensile o annuale.",
  invalid_billing_period: "Periodo di fatturazione mancante o incoerente: non è stato applicato.",
  invalid_items: "Voci dell’abbonamento non leggibili.",
  invalid_subscription: "Dati dell’abbonamento incompleti.",
  invalid_adjustment: "Rimborso o rettifica con dati incompleti.",
  unknown_subscription: "Rimborso o rettifica di un abbonamento che KlokShift non conosce.",
};


export function RejectedEvents({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "rejected-events", { offset }, () => listRejectedBillingEvents(true, offset));
  const title = "Avvisi Paddle scartati";
  if (query.isPending || query.isFetching) return <CardSkeleton title={title} rows={2} />;
  if (query.isError) return <Card><SectionHeader title={title} icon="inbox" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  if (d.items.length === 0 && offset === 0) return <AllClear icon="inbox" title={title}>Nessun avviso scartato: tutto quello che Paddle ha mandato è stato applicato.</AllClear>;
  return <Card>
    <SectionHeader title={title} icon="inbox" tone="error" count={d.open_total > 0 ? `${d.open_total} da verificare` : undefined} />
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessuna voce in questa pagina.</p>
      : <ul className="space-y-3">{d.items.map((e) => <EventItem key={`${e.environment}-${e.event_id}`} e={e} />)}</ul>}
    <Pager page={d} onOffset={setOffset} />
    <Footnote className="mt-4">Un avviso scartato non cambia nessun accesso e Paddle non lo rimanda: serve un controllo a mano.</Footnote>
  </Card>;
}

function EventItem({ e }: { e: RejectedBillingEvent }) {
  const [note, setNote] = useState("");
  const resolve = useAdminWrite(resolveBillingEvent);
  return <AttentionItem tone="error">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {e.workspace_id && e.workspace_name
        ? <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${e.workspace_id}`}>{e.workspace_name}</Link>
        : <span className="font-semibold">Azienda non riconosciuta</span>}
      <span className="rounded-md bg-bg-3 px-1.5 py-0.5 font-mono text-xs text-t2">{e.event_type}</span>
      {e.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
    </div>
    <p className="mt-1 text-xs text-t3">{date(e.received_at)}{e.paddle_id ? <> · <span className="font-mono">{e.paddle_id}</span></> : ""}</p>
    <ActionBox>
      <p className="flex items-start gap-2 text-sm text-t1"><Icon name="alert" className="mt-0.5 size-4 text-error" />{errorLabels[e.error ?? ""] ?? `Scartato (${e.error ?? "motivo non indicato"}).`}</p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(ev) => {
        ev.preventDefault();
        resolve.mutate({ environment: e.environment, eventId: e.event_id, note: note.trim() }, { onSuccess: () => setNote("") });
      }}>
        <div className="min-w-56 flex-1"><Field label="Cosa hai fatto"><Input required minLength={3} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} /></Field></div>
        <Button type="submit" variant="gold" disabled={resolve.isPending || note.trim().length < 3}><Icon name="check" className="size-4" />{resolve.isPending ? "Salvataggio…" : "Segna come verificato"}</Button>
      </form>
      {resolve.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(resolve.error)}</p> : null}
    </ActionBox>
  </AttentionItem>;
}
