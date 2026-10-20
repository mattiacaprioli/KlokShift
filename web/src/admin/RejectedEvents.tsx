import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { listRejectedBillingEvents, resolveBillingEvent } from "@/features/admin/billing";
import type { RejectedBillingEvent } from "@/features/admin/billing";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card, Field, Input, Pill, Spinner } from "../ui/primitives";

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

function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value));
}

export function RejectedEvents({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "rejected-events", { offset }, () => listRejectedBillingEvents(true, offset));
  if (query.isPending || query.isFetching) return <Card><h2 className="mb-3 font-semibold">Avvisi Paddle scartati</h2><Spinner /></Card>;
  if (query.isError) return <Card><h2 className="mb-3 font-semibold">Avvisi Paddle scartati</h2><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  return <Card>
    <div className="mb-3 flex flex-wrap items-center gap-3"><h2 className="font-semibold">Avvisi Paddle scartati</h2>
      {d.open_total > 0 ? <Pill tone="error">{d.open_total} da verificare</Pill> : null}</div>
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessun avviso scartato: tutto quello che Paddle ha mandato è stato applicato.</p>
      : <ul className="divide-y divide-border-2">{d.items.map((e) => <EventItem key={`${e.environment}-${e.event_id}`} e={e} />)}</ul>}
    {d.total > d.limit ? <div className="mt-4 flex gap-3">
      <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - d.limit))}>Precedenti</Button>
      <Button disabled={offset + d.limit >= d.total} onClick={() => setOffset(offset + d.limit)}>Successivi</Button>
    </div> : null}
    <p className="mt-4 text-xs text-t4">Un avviso scartato non cambia nessun accesso e Paddle non lo rimanda: serve un controllo a mano.</p>
  </Card>;
}

function EventItem({ e }: { e: RejectedBillingEvent }) {
  const [note, setNote] = useState("");
  const resolve = useAdminWrite(resolveBillingEvent);
  return <li className="py-4">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {e.workspace_id && e.workspace_name
        ? <Link className="font-semibold text-gold" to={`/amministrazione/aziende/${e.workspace_id}`}>{e.workspace_name}</Link>
        : <span className="font-semibold">Azienda non riconosciuta</span>}
      <span className="font-mono text-xs text-t3">{e.event_type}</span>
      {e.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
    </div>
    <p className="mt-1 text-xs text-t3">{date(e.received_at)}{e.paddle_id ? ` · ${e.paddle_id}` : ""}</p>
    <p className="mt-2 text-sm text-gold">{errorLabels[e.error ?? ""] ?? `Scartato (${e.error ?? "motivo non indicato"}).`}</p>
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(ev) => {
      ev.preventDefault();
      resolve.mutate({ environment: e.environment, eventId: e.event_id, note: note.trim() }, { onSuccess: () => setNote("") });
    }}>
      <Field label="Cosa hai fatto"><Input required minLength={3} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
      <Button type="submit" disabled={resolve.isPending || note.trim().length < 3}>{resolve.isPending ? "Salvataggio…" : "Segna come verificato"}</Button>
    </form>
    {resolve.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(resolve.error)}</p> : null}
  </li>;
}
