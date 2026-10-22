import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { cleanupWorkspaceFiles, deleteWorkspaceDataAndFiles, listExpiredArchives } from "@/features/admin/archives";
import type { CleanupResult, ExpiredArchive } from "@/features/admin/archives";
import { userErrorMessage } from "@/lib/errors";
import { date, plural as n } from "./format";
import { Button, Card, Field, Input, Pill, Textarea } from "../ui/primitives";
import { ActionBox, AllClear, AttentionItem, CardSkeleton, DangerZone, Footnote, Icon, IconBadge, Pager, SectionHeader } from "./ui";

function inventoryText(i: ExpiredArchive["inventory"]) {
  return [n(i.venues, "sede", "sedi"), n(i.shifts, "turno", "turni"), n(i.clock_records, "timbratura", "timbrature"),
    n(i.members, "scheda", "schede"), n(i.absences, "assenza", "assenze"), n(i.documents, "documento", "documenti"),
    n(i.conversations, "chat", "chat"), n(i.messages, "messaggio", "messaggi")].join(" · ");
}

/** Archivi scaduti: la cancellazione dei dati la avvia il fondatore (decisione del 19/10). */
export function ExpiredArchives({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "expired-archives", { offset }, () => listExpiredArchives(offset));
  const title = "Archivi scaduti";
  if (query.isPending || query.isFetching) return <CardSkeleton title={title} rows={2} />;
  if (query.isError) return <Card><SectionHeader title={title} icon="archive" /><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  if (d.items.length === 0 && offset === 0) return <AllClear icon="archive" title={title}>Nessun archivio scaduto: nessun dato da cancellare.</AllClear>;
  return <Card>
    <SectionHeader title={title} icon="archive" count={d.total > 0 ? d.total : undefined} />
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessuna voce in questa pagina.</p>
      : <ul className="space-y-3">{d.items.map((a) => <ArchiveItem key={a.workspace_id} a={a} />)}</ul>}
    <Pager page={d} onOffset={setOffset} />
    <Footnote className="mt-4">Si cancellano i dati operativi dell’azienda: sedi, turni, ore, assenze, schede, documenti, chat e i loro file. Restano gli account delle persone, le loro altre aziende e il registro commerciale. I backup scadono da soli e non si ripristinano per un cliente.</Footnote>
  </Card>;
}

function Inventory({ i }: { i: ExpiredArchive["inventory"] }) {
  return <div className="mt-3">
    <p className="sr-only">Verrà cancellato: {inventoryText(i)}.</p>
    <p aria-hidden className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-t4">Verrà cancellato</p>
    <ul aria-hidden className="flex flex-wrap gap-1.5">{inventoryText(i).split(" · ").map((part) =>
      <li key={part} className="rounded-lg border border-border-2 bg-bg-card px-2 py-1 text-xs text-t2">{part}</li>)}</ul>
  </div>;
}

function ArchiveItem({ a }: { a: ExpiredArchive }) {
  const [open, setOpen] = useState(false);
  const cleanup = useAdminWrite(cleanupWorkspaceFiles);
  const pending = a.inventory.files_pending;
  const cleaned = cleanup.data as CleanupResult | undefined;

  return <AttentionItem tone={a.data_deleted_at ? (pending > 0 ? "warning" : "neutral") : "error"}>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link className="focus-gold rounded font-semibold text-t1 hover:text-gold" to={`/amministrazione/aziende/${a.workspace_id}`}>{a.workspace_name}</Link>
      {a.data_deleted_at ? <Pill>Dati cancellati</Pill> : <Pill tone="warning">Da cancellare</Pill>}
    </div>
    <p className="mt-1 text-xs text-t3">
      {a.data_deleted_at ? `Dati cancellati il ${date(a.data_deleted_at)}.`
        : a.deleted_at && (!a.archive_until || Date.parse(a.archive_until) > Date.parse(a.deleted_at))
          ? `Azienda chiusa il ${date(a.deleted_at)} con l’account del titolare.`
          : a.archive_until ? `Archivio scaduto il ${date(a.archive_until)}.` : "Archivio scaduto."}
      {pending > 0 ? ` ${n(pending, "file", "file")} ancora da togliere dallo Storage.` : ""}
    </p>
    {!a.data_deleted_at ? <Inventory i={a.inventory} /> : null}

    {a.data_deleted_at ? (pending > 0 ? <div className="mt-3">
      <Button disabled={cleanup.isPending} onClick={() => cleanup.mutate(a.workspace_id)}><Icon name="trash" className="size-4" />{cleanup.isPending ? "Pulizia…" : "Togli i file rimasti"}</Button>
    </div> : null)
      : a.subscription_open ? <ActionBox><p className="flex items-start gap-2 text-sm text-t1"><Icon name="alert" className="mt-0.5 size-4 text-warning" />L’abbonamento è ancora aperto su Paddle: disdicilo prima di cancellare i dati.</p></ActionBox>
      : !open ? <div className="mt-3"><Button variant="danger" onClick={() => setOpen(true)}><Icon name="trash" className="size-4" />Cancella i dati…</Button></div>
      : <DeletionForm workspaceId={a.workspace_id} workspaceName={a.workspace_name} customerRequest={false} onCancel={() => setOpen(false)} />}
    {cleanup.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(cleanup.error)}</p> : null}
    {cleaned ? <p role="status" className="mt-2 text-sm text-t2">{cleaned.remaining
      ? `Tolti ${cleaned.removed} file; ${cleaned.failed || "alcuni"} non ancora: riprova fra poco.`
      : `File tolti dallo Storage: ${cleaned.removed}.`}</p> : null}
  </AttentionItem>;
}

/**
 * Conferma della cancellazione: motivo, nome esatto, poi dati e file. La stessa
 * per l'archivio scaduto e per la richiesta del cliente; il server ricontrolla.
 */
export function DeletionForm({ workspaceId, workspaceName, customerRequest, onCancel }: {
  workspaceId: string; workspaceName: string; customerRequest: boolean; onCancel: () => void;
}) {
  const [operationId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const remove = useAdminWrite(deleteWorkspaceDataAndFiles);
  const matches = name.trim() === workspaceName.trim();
  return <form className="mt-3 space-y-4 rounded-xl border border-error/30 bg-error/[0.05] p-4" onSubmit={(e) => {
    e.preventDefault();
    remove.mutate({ workspaceId, operationId, confirmName: name, reason: reason.trim(), customerRequest });
  }}>
    <p className="flex items-start gap-2 text-sm text-t1"><Icon name="alert" className="mt-0.5 size-4 text-error" />{customerRequest
      ? "La cancellazione non si può annullare. Procedi solo con una richiesta scritta di chi gestisce l’azienda e indica nel motivo quando e come è arrivata."
      : "La cancellazione non si può annullare. Il cliente ha avuto 12 mesi per esportare i dati."}</p>
    <Field label="Motivo"><Textarea required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    {/* Fuori dall'etichetta: le etichette sono in maiuscolo e il nome va copiato com'è. */}
    <p className="text-sm text-t2">Per confermare scrivi il nome dell’azienda esattamente così: <strong className="rounded-md bg-bg-2 px-1.5 py-0.5 font-mono text-t1">{workspaceName}</strong></p>
    <Field label="Nome dell’azienda"><Input className={matches && name ? "border-error/60" : undefined} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="danger" disabled={remove.isPending || !reason.trim() || !matches}>
        <Icon name="trash" className="size-4" />{remove.isPending ? "Cancellazione…" : "Cancella definitivamente"}
      </Button>
      <Button disabled={remove.isPending} onClick={() => { setName(""); onCancel(); }}>Annulla</Button>
    </div>
    {remove.error ? <p role="alert" className="text-sm text-error">{userErrorMessage(remove.error)}</p> : null}
  </form>;
}

/** Scheda azienda → Gestione: cancellazione anticipata, solo per un'azienda che non lavora. */
export function CustomerDeletion({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [open, setOpen] = useState(false);
  return <DangerZone>
    <div className="flex items-start gap-3">
      <IconBadge icon="trash" tone="error" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Cancella i dati su richiesta del cliente</h2>
        <p className="mt-1 text-sm text-t3">Per un’azienda in archivio o mai attivata, se chi la gestisce chiede di cancellare i dati prima della scadenza. Si cancella quello che si cancella a fine archivio; restano gli account e il registro commerciale. Con un abbonamento ancora aperto su Paddle il server rifiuta.</p>
        {open ? <DeletionForm workspaceId={workspaceId} workspaceName={workspaceName} customerRequest onCancel={() => setOpen(false)} />
          : <div className="mt-3"><Button variant="danger" onClick={() => setOpen(true)}>Cancella i dati…</Button></div>}
      </div>
    </div>
  </DangerZone>;
}
