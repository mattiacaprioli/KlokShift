import { useRef, useState } from "react";
import { userErrorMessage } from "@/lib/errors";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  type StaffDocument,
} from "@/features/documents/api";
import {
  useCreateStaffDocument,
  useDeleteStaffDocument,
  useDocumentUrl,
  useStaffDocuments,
} from "@/features/documents/hooks";
import { documentStatus, documentStatusLabel } from "@/features/documents/status";
import { useToast } from "../ui/Toast";
import { Button, Card, Input, Pill, Spinner } from "../ui/primitives";

/** Nessun browser renderizza l'HEIC: per quelli si offre solo il download. */
function canPreview(mime: string | null): boolean {
  return !!mime && mime !== "image/heic" && mime !== "image/heif";
}

/**
 * I documenti di una persona dell'organico, dalla scrivania.
 *
 * È qui che la feature paga: la programmazione e i controlli di conformità si
 * fanno da desktop, e un HACCP scaduto è più facile vederlo in una tabella che
 * su un telefono.
 */
export function DocumentsPanel({ personId }: { personId: string }) {
  const toast = useToast();
  const { data, isPending } = useStaffDocuments(personId);
  const docs = data ?? [];

  const create = useCreateStaffDocument(personId);
  const remove = useDeleteStaffDocument(personId);
  const signedUrl = useDocumentUrl();

  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function openDoc(doc: StaffDocument, download: boolean) {
    try {
      const url = await signedUrl.mutateAsync({
        storagePath: doc.storage_path,
        download: download ? doc.name : undefined,
      });
      // `noopener,noreferrer`: l'URL firmata è un lasciapassare, non va lasciata
      // raggiungibile da `window.opener`.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.show(userErrorMessage(e, "Apertura non riuscita"), "error");
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (picked && picked.size > DOCUMENT_MAX_BYTES) {
      toast.show("Il file supera 10 MB.", "error");
      return;
    }
    setFile(picked);
    if (picked && !name.trim()) setName(picked.name.replace(/\.[^.]+$/, ""));
  }

  function reset() {
    setName("");
    setExpiresAt("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onUpload() {
    if (!file || !name.trim()) return;
    create.mutate(
      {
        meta: { name, expires_at: expiresAt || null },
        file: {
          bytes: file,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      },
      {
        onSuccess: () => {
          toast.show("Documento aggiunto");
          reset();
        },
        onError: (e) => toast.show(userErrorMessage(e), "error"),
      }
    );
  }

  if (isPending) return <Spinner />;

  return (
    <section className="flex flex-col gap-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-t3">
        Documenti
      </span>

      {docs.length === 0 ? (
        <p className="text-xs text-t4">
          Nessun documento. Carica HACCP, contratti o attestati: restano qui con
          le loro scadenze.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {docs.map((doc) => {
            const status = documentStatus(doc.expires_at);
            return (
              <Card
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-t1">
                    {doc.name}
                  </span>
                  <span
                    className={
                      status === "expired"
                        ? "text-xs text-error"
                        : "text-xs text-t4"
                    }
                  >
                    {documentStatusLabel(doc.expires_at)}
                  </span>
                </span>

                {status === "expired" ? (
                  <Pill tone="error">Scaduto</Pill>
                ) : status === "expiring" ? (
                  <Pill tone="warning">In scadenza</Pill>
                ) : null}

                {canPreview(doc.mime_type) ? (
                  <Button onClick={() => openDoc(doc, false)}>Apri</Button>
                ) : null}
                <Button onClick={() => openDoc(doc, true)}>Scarica</Button>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(doc, {
                      onSuccess: () => toast.show("Documento eliminato"),
                      onError: (e) => toast.show(userErrorMessage(e), "error"),
                    })
                  }
                >
                  Elimina
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <input
          ref={fileRef}
          type="file"
          accept={DOCUMENT_MIME_TYPES.join(",")}
          onChange={onPick}
          className="text-xs text-t3"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome del documento"
          className="max-w-56"
        />
        <Input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="max-w-44"
        />
        <Button
          variant="gold"
          disabled={!file || !name.trim() || create.isPending}
          onClick={onUpload}
        >
          {create.isPending ? "Caricamento…" : "Aggiungi"}
        </Button>
        <span className="text-xs text-t4">
          Scadenza facoltativa · PDF o immagine, max 10 MB
        </span>
      </Card>
    </section>
  );
}
