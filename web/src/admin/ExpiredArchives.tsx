import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRead, useAdminWrite } from "@/features/admin/hooks";
import { cleanupWorkspaceFiles, deleteWorkspaceDataAndFiles, listExpiredArchives } from "@/features/admin/archives";
import type { CleanupResult, ExpiredArchive } from "@/features/admin/archives";
import { userErrorMessage } from "@/lib/errors";
import { Button, Card, Field, Input, Pill, Spinner, Textarea } from "../ui/primitives";

function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value));
}
const n = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
function inventoryText(i: ExpiredArchive["inventory"]) {
  return [n(i.venues, "sede", "sedi"), n(i.shifts, "turno", "turni"), n(i.clock_records, "timbratura", "timbrature"),
    n(i.members, "scheda", "schede"), n(i.absences, "assenza", "assenze"), n(i.documents, "documento", "documenti"),
    n(i.conversations, "chat", "chat"), n(i.messages, "messaggio", "messaggi")].join(" · ");
}

/** Archivi scaduti: la cancellazione dei dati la avvia il fondatore (decisione del 19/10). */
export function ExpiredArchives({ userId }: { userId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useAdminRead(userId, "expired-archives", { offset }, () => listExpiredArchives(offset));
  if (query.isPending || query.isFetching) return <Card><h2 className="mb-3 font-semibold">Archivi scaduti</h2><Spinner /></Card>;
  if (query.isError) return <Card><h2 className="mb-3 font-semibold">Archivi scaduti</h2><p role="alert" className="text-sm text-error">{userErrorMessage(query.error)}</p></Card>;
  const d = query.data;
  return <Card>
    <div className="mb-3 flex flex-wrap items-center gap-3"><h2 className="font-semibold">Archivi scaduti</h2>
      {d.total > 0 ? <Pill tone="warning">{d.total}</Pill> : null}</div>
    {d.items.length === 0
      ? <p className="text-sm text-t3">Nessun archivio scaduto: nessun dato da cancellare.</p>
      : <ul className="divide-y divide-border-2">{d.items.map((a) => <ArchiveItem key={a.workspace_id} a={a} />)}</ul>}
    {d.total > d.limit ? <div className="mt-4 flex gap-3">
      <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - d.limit))}>Precedenti</Button>
      <Button disabled={offset + d.limit >= d.total} onClick={() => setOffset(offset + d.limit)}>Successivi</Button>
    </div> : null}
    <p className="mt-4 text-xs text-t4">Si cancellano i dati operativi dell’azienda: sedi, turni, ore, assenze, schede, documenti, chat e i loro file. Restano gli account delle persone, le loro altre aziende e il registro commerciale. I backup scadono da soli e non si ripristinano per un cliente.</p>
  </Card>;
}

function ArchiveItem({ a }: { a: ExpiredArchive }) {
  const [open, setOpen] = useState(false);
  const cleanup = useAdminWrite(cleanupWorkspaceFiles);
  const pending = a.inventory.files_pending;
  const cleaned = cleanup.data as CleanupResult | undefined;

  return <li className="py-4">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link className="font-semibold text-gold" to={`/amministrazione/aziende/${a.workspace_id}`}>{a.workspace_name}</Link>
      {a.data_deleted_at ? <Pill>Dati cancellati</Pill> : <Pill tone="warning">Da cancellare</Pill>}
    </div>
    <p className="mt-1 text-xs text-t3">
      {a.data_deleted_at ? `Dati cancellati il ${date(a.data_deleted_at)}.`
        : a.deleted_at && (!a.archive_until || Date.parse(a.archive_until) > Date.parse(a.deleted_at))
          ? `Azienda chiusa il ${date(a.deleted_at)} con l’account del titolare.`
          : a.archive_until ? `Archivio scaduto il ${date(a.archive_until)}.` : "Archivio scaduto."}
      {pending > 0 ? ` ${n(pending, "file", "file")} ancora da togliere dallo Storage.` : ""}
    </p>
    {!a.data_deleted_at ? <p className="mt-1 text-xs text-t4">Verrà cancellato: {inventoryText(a.inventory)}.</p> : null}

    {a.data_deleted_at ? (pending > 0 ? <div className="mt-3">
      <Button disabled={cleanup.isPending} onClick={() => cleanup.mutate(a.workspace_id)}>{cleanup.isPending ? "Pulizia…" : "Togli i file rimasti"}</Button>
    </div> : null)
      : a.subscription_open ? <p className="mt-2 text-sm text-gold">L’abbonamento è ancora aperto su Paddle: disdicilo prima di cancellare i dati.</p>
      : !open ? <div className="mt-3"><Button onClick={() => setOpen(true)}>Cancella i dati…</Button></div>
      : <DeletionForm workspaceId={a.workspace_id} workspaceName={a.workspace_name} customerRequest={false} onCancel={() => setOpen(false)} />}
    {cleanup.error ? <p role="alert" className="mt-2 text-sm text-error">{userErrorMessage(cleanup.error)}</p> : null}
    {cleaned ? <p role="status" className="mt-2 text-sm text-t2">{cleaned.remaining
      ? `Tolti ${cleaned.removed} file; ${cleaned.failed || "alcuni"} non ancora: riprova fra poco.`
      : `File tolti dallo Storage: ${cleaned.removed}.`}</p> : null}
  </li>;
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
  return <form className="mt-3 space-y-3 rounded-xl bg-bg-2 p-4" onSubmit={(e) => {
    e.preventDefault();
    remove.mutate({ workspaceId, operationId, confirmName: name, reason: reason.trim(), customerRequest });
  }}>
    <p className="text-sm text-t1">{customerRequest
      ? "La cancellazione non si può annullare. Procedi solo con una richiesta scritta di chi gestisce l’azienda e indica nel motivo quando e come è arrivata."
      : "La cancellazione non si può annullare. Il cliente ha avuto 12 mesi per esportare i dati."}</p>
    <Field label="Motivo"><Textarea required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    {/* Fuori dall'etichetta: le etichette sono in maiuscolo e il nome va copiato com'è. */}
    <p className="text-sm text-t2">Per confermare scrivi il nome dell’azienda esattamente così: <strong className="text-t1">{workspaceName}</strong></p>
    <Field label="Nome dell’azienda"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="danger" disabled={remove.isPending || !reason.trim() || name.trim() !== workspaceName.trim()}>
        {remove.isPending ? "Cancellazione…" : "Cancella definitivamente"}
      </Button>
      <Button disabled={remove.isPending} onClick={() => { setName(""); onCancel(); }}>Annulla</Button>
    </div>
    {remove.error ? <p role="alert" className="text-sm text-error">{userErrorMessage(remove.error)}</p> : null}
  </form>;
}

/** Scheda azienda → Gestione: cancellazione anticipata, solo per un'azienda che non lavora. */
export function CustomerDeletion({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [open, setOpen] = useState(false);
  return <Card>
    <h2 className="font-semibold">Cancella i dati su richiesta del cliente</h2>
    <p className="mt-2 text-sm text-t3">Per un’azienda in archivio o mai attivata, se chi la gestisce chiede di cancellare i dati prima della scadenza. Si cancella quello che si cancella a fine archivio; restano gli account e il registro commerciale. Con un abbonamento ancora aperto su Paddle il server rifiuta.</p>
    {open ? <DeletionForm workspaceId={workspaceId} workspaceName={workspaceName} customerRequest onCancel={() => setOpen(false)} />
      : <div className="mt-3"><Button onClick={() => setOpen(true)}>Cancella i dati…</Button></div>}
  </Card>;
}
