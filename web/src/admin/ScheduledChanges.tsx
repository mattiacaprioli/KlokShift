import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { canRetryScheduledChange, listScheduledChanges, resolveScheduledChange, retryScheduledChange, scheduledFailureReason } from "@/features/admin/scheduledChanges";
import type { ScheduledBillingChange } from "@/features/admin/scheduledChanges";
import { userErrorMessage } from "@/lib/errors";
import { date } from "./format";
import { Button, Card, Field, Input, Pill } from "../ui/primitives";
import { ActionBox, AllClear, AttentionItem, CardSkeleton, Footnote, Icon, Pager, SectionHeader } from "./ui";

function alertText(c: ScheduledBillingChange): string {
  if (c.alert_kind === "not_sent") return "Il cambio non è ancora arrivato a Paddle e il rinnovo è fra meno di 6 ore. Prova a inviarlo di nuovo; se non va, al rinnovo Paddle addebita il piano attuale e la differenza va rimborsata.";
  if (c.alert_kind === "date_not_fixed") return `Il ciclo è cambiato su Paddle ma la data del rinnovo no: finché non torna al ${date(c.effective_at)}, Paddle non addebita nel giorno giusto. Prova «Riprova adesso»; se non va, rimetti la data su Paddle.`;
  if (c.alert_kind === "failed") return `Il cambio non si può applicare (${scheduledFailureReason(c)}): il rinnovo avverrà col piano attuale. Avvisa il titolare.`;
  if (c.alert_kind === "renewal_overdue") return "Paddle non ha rinnovato alla data del cambio: controlla data e articoli su Paddle, poi chiudi l'avviso con una nota.";
  // Esito positivo arrivato dopo una pausa, una disdetta o un fallimento: Paddle ha il cambio, la riga è chiusa.
  if (c.close_reason !== "renewal_mismatch") return "Paddle ha ricevuto il cambio, ma qui risultava già chiuso: controlla su Paddle articoli e data del rinnovo, poi chiudi l'avviso con una nota.";
  return "Il rinnovo è avvenuto con un piano diverso da quello programmato: controlla su Paddle e rimborsa la differenza.";
}
const planNames = { base: "Base", team: "Team" } as const;
const intervalNames = { month: "mensile", year: "annuale" } as const;
const statusLabels: Record<ScheduledBillingChange["status"], string> = {
  pending: "In attesa", applied: "Inviato a Paddle", confirmed: "Confermato", canceled: "Annullato", failed: "Non applicato",
};

/** Cambi di piano al rinnovo: da verificare (tutte le aziende) o lo storico di un'azienda. */
export function ScheduledChanges({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const [offset, setOffset] = useState(0);
  const filters = { workspaceId: workspaceId ?? null, attentionOnly: !workspaceId, offset };
  const query = useAdminRead(userId, "scheduled-changes", filters, () => listScheduledChanges(filters));
  const title = workspaceId ? "Cambi di piano programmati" : "Cambi di piano da verificare";
  // Lo scheletro solo alla prima lettura: un aggiornamento (focus, dopo un
  // ritentativo) non smonta le voci, così nota ed errore del ritentativo restano.
  if (query.isPending) return <CardSkeleton title={title} rows={2} />;
  if (!query.data) return <Card><SectionHeader title={title} icon="euro" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  if (d.items.length === 0 && offset === 0) return <AllClear icon="euro" title={title}>
    {workspaceId ? "Nessun cambio programmato per questa azienda." : "Niente da verificare: i cambi programmati partono da soli prima del rinnovo."}
  </AllClear>;
  return <Card>
    <SectionHeader title={title} icon="euro" count={d.open_total > 0 ? `${d.open_total} da verificare` : undefined} />
    {query.isError ? <p role="alert" className="mb-3 text-sm text-error">{userErrorMessage(query.error)}</p> : null}
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessuna voce in questa pagina.</p>
      : <ul className="space-y-3">{d.items.map((c) => <ChangeItem key={c.id} c={c} showWorkspace={!workspaceId} />)}</ul>}
    <Pager page={d} onOffset={setOffset} />
    <Footnote className="mt-4">Riduzioni e cambi di ciclo si applicano al rinnovo. Un rimborso della differenza si fa su Paddle.</Footnote>
  </Card>;
}

function ChangeItem({ c, showWorkspace }: { c: ScheduledBillingChange; showWorkspace: boolean }) {
  const [note, setNote] = useState("");
  const resolve = useAdminWrite(resolveScheduledChange);
  const retry = useAdminWrite(retryScheduledChange);
  const open = c.alert_kind !== null && c.reviewed_at === null;
  return <AttentionItem tone={open ? (c.alert_kind === "renewal_mismatch" ? "error" : "warning") : "neutral"}>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showWorkspace ? <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${c.workspace_id}`}>{c.workspace_name}</Link> : null}
      <span className="font-semibold">{planNames[c.target_plan]} {intervalNames[c.target_interval]}{c.target_extra_venues > 0 ? ` + ${c.target_extra_venues} sedi` : ""}</span>
      <Pill tone={c.status === "failed" ? "warning" : "neutral"}>{statusLabels[c.status]}</Pill>
      {c.environment === "sandbox" ? <Pill>Sandbox</Pill> : null}
    </div>
    <p className="mt-1 text-xs text-t3">Rinnovo del {date(c.effective_at)} · richiesto il {date(c.created_at)} · {c.attempts} tentativi.</p>
    {c.requested_by_name ? <p className="mt-0.5 text-xs text-t3">Chiesto da {c.requested_by_name}</p> : null}
    {open ? <ActionBox>
      <p className="flex items-start gap-2 text-sm text-t1"><Icon name="alert" className="mt-0.5 size-4 text-warning" />{alertText(c)}</p>
      {canRetryScheduledChange(c) ? <div className="mt-3">
        <Button type="button" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate(c.id)}>{retry.isPending ? "Invio…" : "Riprova adesso"}</Button>
        {retry.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(retry.error)}</p> : null}
      </div> : null}
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        resolve.mutate({ id: c.id, note: note.trim() }, { onSuccess: () => setNote("") });
      }}>
        <div className="min-w-56 flex-1"><Field label="Cosa hai fatto"><Input required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <Button type="submit" variant="gold" disabled={resolve.isPending || note.trim().length < 3}><Icon name="check" className="size-4" />{resolve.isPending ? "Salvataggio…" : "Segna come verificato"}</Button>
      </form>
      {resolve.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(resolve.error)}</p> : null}
    </ActionBox> : c.reviewed_at ? <p className="mt-2 flex items-center gap-1.5 text-xs text-t3"><Icon name="check" className="size-3.5 text-success" />Verificato il {date(c.reviewed_at)}: {c.review_note}</p> : null}
  </AttentionItem>;
}
