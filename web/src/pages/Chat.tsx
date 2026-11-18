import { ChatSkeleton, ListSkeleton, MessageSkeleton } from "../ui/Skeleton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  useConversations,
  useStartConversation,
  useWorkspaceContacts,
} from "@/features/chat/hooks";
import { useChatThread } from "@/features/chat/useChatThread";
import { userErrorMessage } from "@/lib/errors";
import { timeAgo, toTimeString } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ChangeRequestCard } from "../chat/ChangeRequestCard";
import { MessageTicks } from "../chat/MessageTicks";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { MoreMenu, type MoreMenuItem } from "../ui/MoreMenu";
import {
  DELETED_TEXT,
  canDelete,
  canEdit,
  previewText,
} from "@/features/chat/messageActions";
import { messageSchema } from "@/features/chat/schema";
import type { Message } from "@/features/chat/api";
import {
  messageStatus,
  otherDeliveredAt,
  type MessageStatus,
} from "@/features/chat/messageStatus";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import {
  Button,
  Card,
  Input,
  PageHeader,
  Pill,
  Placeholder,
  QueryError,
} from "../ui/primitives";

/**
 * Messaggi: lista conversazioni a sinistra, thread aperto a destra. Sul telefono
 * sono due schermate; su desktop stanno insieme, così si risponde a più persone
 * senza tornare indietro ogni volta.
 */
export function ChatPage() {
  const { session } = useAuth();
  const userId = session!.user.id;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const query = useConversations(userId);

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Messaggi" />
        <ChatSkeleton />
      </>
    );
  }
  if (query.isError) return <QueryError error={query.error} />;

  const conversations = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Messaggi"
        actions={
          <Button variant="gold" onClick={() => setPicking((v) => !v)}>
            {picking ? "Annulla" : "+ Nuovo messaggio"}
          </Button>
        }
      />

      {picking ? (
        <ContactPicker
          userId={userId}
          onOpened={(conversationId) => {
            setPicking(false);
            navigate(`/chat/${conversationId}`);
          }}
        />
      ) : null}

      {/* La lista arriva dal DB con `!inner` sui messaggi: una conversazione
          appena aperta non c'è ancora. Se l'URL ne indica una si mostra
          comunque il thread, altrimenti si finirebbe sullo stato vuoto dopo
          aver appena chiesto di scrivere a qualcuno. */}
      {conversations.length === 0 && !id ? (
        <Placeholder
          title="Nessuna conversazione"
          detail="Scegli “Nuovo messaggio” per scrivere a una persona del tuo team, oppure parti dalla sua scheda in Team."
        />
      ) : (
        <div className="grid h-[calc(100dvh-12rem)] grid-cols-[20rem_1fr] gap-6">
          <div className="flex flex-col gap-2 overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border-2 p-3 text-xs leading-5 text-t4">
                Questa conversazione comparirà nell&apos;elenco dopo il primo
                messaggio.
              </p>
            ) : null}
            {conversations.map((c) => {
              const active = c.id === id;
              const mine = c.lastMessage?.sender_id === userId;
              // Le spunte prendono il posto di «Tu:» sui miei messaggi di
              // testo; le card del cambio turno restano col prefisso.
              const ticks =
                c.lastMessage &&
                mine &&
                c.lastMessage.kind === "text" &&
                c.lastMessage.deleted_at == null
                  ? messageStatus(c.lastMessage, otherDeliveredAt(c, userId))
                  : null;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/chat/${c.id}`)}
                  className={cn(
                    "focus-gold flex shrink-0 items-center gap-3 rounded-2xl border p-3 text-left transition",
                    active
                      ? "border-border-gold bg-gold/10"
                      : "border-border-2 bg-bg-card hover:bg-bg-1"
                  )}
                >
                  <Avatar url={c.other.avatarUrl} name={c.other.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-sm font-semibold text-t1">
                          {c.other.name}
                        </span>
                        {c.other.subtitle ? (
                          <span className="truncate text-[11px] text-t4">
                            · {c.other.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {c.lastMessage ? (
                        <span className="shrink-0 text-[11px] text-t4">
                          {timeAgo(c.lastMessage.created_at)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        {ticks ? (
                          <MessageTicks status={ticks} tone="list" />
                        ) : null}
                        <span className="truncate text-xs text-t3">
                          {c.lastMessage
                            ? `${mine && !ticks ? "Tu: " : ""}${previewText(c.lastMessage)}`
                            : "Nessun messaggio"}
                        </span>
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-gold-fill px-1.5 text-[11px] font-bold text-gold-ink">
                          {c.unreadCount > 9 ? "9+" : c.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
            {query.hasNextPage ? (
              <Button
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Caricamento…" : "Carica altre"}
              </Button>
            ) : null}
          </div>

          {id ? (
            <Thread key={id} conversationId={id} userId={userId} />
          ) : (
            <Placeholder
              title="Scegli una conversazione"
              detail="Selezionala dall'elenco a sinistra."
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * Scelta del destinatario per una chat nuova: la **rubrica dell'azienda**, la
 * stessa dell'app (`get_workspace_contacts`).
 *
 * Non è più «le persone del titolare»: da quando si parlano tutti i membri, qui
 * ci sono anche i colleghi e chi collabora alla gestione. Restano fuori solo
 * quelli senza account — dall'altra parte non ci sarebbe nessuno — e, se
 * l'azienda ha spento la chat fra colleghi, chi non gestisce niente.
 *
 * Chi ha già una conversazione resta in lista: riaprirla è lo stesso gesto, e
 * `open_conversation` non ne crea una seconda.
 */
function ContactPicker({
  userId,
  onOpened,
}: {
  userId: string;
  onOpened: (conversationId: string) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const startConversation = useStartConversation();
  const { data, isPending, isError, error } = useWorkspaceContacts(userId);

  const contacts = data ?? [];
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          (c.venues ?? "").toLowerCase().includes(needle)
      )
    : contacts;
  // L'azienda si nomina solo a chi ne ha più di una: per tutti gli altri
  // sarebbe la stessa riga ripetuta sopra ogni nome.
  const multiWorkspace = new Set(contacts.map((c) => c.workspaceId)).size > 1;

  function open(memberId: string) {
    setOpeningId(memberId);
    startConversation.mutate(
      { memberId },
      {
        onSuccess: (conv) => onOpened(conv.id),
        onError: (e) => {
          setOpeningId(null);
          toast.show(userErrorMessage(e), "error");
        },
      }
    );
  }

  return (
    <Card className="mb-6 flex flex-col gap-3 p-4">
      {isPending ? (
        <ListSkeleton avatar rows={3} label="Caricamento contatti…" />
      ) : isError ? (
        <QueryError error={error} />
      ) : contacts.length === 0 ? (
        <p className="py-6 text-center text-xs text-t4">
          Nessuno nel tuo team ha un account collegato: invitali da Team
          per poterci scrivere.
        </p>
      ) : (
        <>
          {contacts.length > 6 ? (
            <Input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Cerca una persona…"
            />
          ) : null}

          {shown.length === 0 ? (
            <p className="py-4 text-center text-xs text-t4">
              Nessun risultato per “{filter.trim()}”.
            </p>
          ) : (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {shown.map((contact) => (
                <button
                  key={contact.memberId}
                  disabled={startConversation.isPending}
                  onClick={() => open(contact.memberId)}
                  className="focus-gold flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-bg-1 disabled:opacity-40"
                >
                  <Avatar
                    url={contact.avatarUrl ?? undefined}
                    name={contact.name}
                    size={32}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-t1">
                      {contact.name}
                    </span>
                    {/* Le sedi e non i ruoli: qui serve sapere "chi è questo",
                        e con più sedi la sede lo dice meglio del ruolo. */}
                    <span className="block truncate text-xs text-t4">
                      {[
                        multiWorkspace ? contact.workspaceName : null,
                        contact.venues ?? "Nessuna sede",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {contact.isManager ? <Pill>Gestione</Pill> : null}
                  <span className="shrink-0 text-xs text-gold">
                    {openingId === contact.memberId && startConversation.isPending
                      ? "Apertura…"
                      : "Scrivi"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Thread({
  conversationId,
  userId,
}: {
  conversationId: string;
  userId: string;
}) {
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Messaggi deduplicati, canale realtime e mark-read vengono dall'hook
  // condiviso con l'app: qui c'è solo la UI.
  const {
    query,
    messages,
    other,
    notFound,
    send,
    submit,
    statusOf,
    pending,
    edit,
    remove,
  } = useChatThread(conversationId, userId);
  // Modifica ed elimina: il messaggio in modifica nel campo e quello da
  // confermare per l'eliminazione.
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);

  function actionsFor(m: Message): MoreMenuItem[] {
    const now = new Date();
    const items: MoreMenuItem[] = [];
    if (canEdit(m, userId, now)) {
      items.push({
        label: "Modifica",
        onSelect: () => {
          setEditing(m);
          setText(m.content);
          setSendError(null);
        },
      });
    }
    if (canDelete(m, userId, now)) {
      items.push({ label: "Elimina", onSelect: () => setDeleting(m) });
    }
    return items;
  }

  // I messaggi arrivano dal più recente: si mostrano invertiti, e si scende in
  // fondo a ogni nuovo arrivo.
  const ordered = [...messages].reverse();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  if (notFound) {
    return (
      <Placeholder
        title="Conversazione non trovata"
        detail="Questa conversazione non è più disponibile."
      />
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (editing) {
      const parsed = messageSchema.safeParse({ content: text });
      if (!parsed.success) {
        setSendError(parsed.error.issues[0].message);
        return;
      }
      edit.mutate(
        { id: editing.id, content: parsed.data.content },
        {
          onSuccess: () => {
            setEditing(null);
            setText("");
            setSendError(null);
          },
          onError: (err) => setSendError(userErrorMessage(err)),
        }
      );
      return;
    }
    const draft = text;
    // Come su WhatsApp il testo lascia subito il campo e diventa la bolla con
    // l'orologio; se l'invio fallisce torna dov'era.
    const invalid = submit(draft, {
      onError: () => {
        setText((current) => (current === "" ? draft : current));
        setSendError("Messaggio non inviato. Riprova.");
      },
    });
    setSendError(invalid);
    if (!invalid) setText("");
  }

  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-border-2 bg-bg-card">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        {other ? <Avatar url={other.avatarUrl} name={other.name} size={36} /> : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-t1">
            {other?.name ?? " "}
          </p>
          {other?.subtitle ? (
            <p className="text-xs text-t4">{other.subtitle}</p>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {query.isError ? (
          <QueryError error={query.error} />
        ) : query.isLoading ? (
          <MessageSkeleton />
        ) : ordered.length === 0 && !pending ? (
          <p className="py-12 text-center text-sm text-t3">
            {other
              ? `Scrivi il primo messaggio a ${other.name}.`
              : "Scrivi il primo messaggio."}
          </p>
        ) : (
          <>
            {query.hasNextPage ? (
              <div className="mb-4 flex justify-center">
                <Button
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage
                    ? "Caricamento…"
                    : "Messaggi precedenti"}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {ordered.map((m) => {
                const own = m.sender_id === userId;
                // Le righe di servizio del cambio turno non sono testo:
                // portano un `request_id` e si rendono come card con i bottoni
                // di chi deve decidere. Le assenze in chat non ci sono più
                // (31/10): una riga rimasta non si mostra.
                if (
                  m.kind === "absence_request" ||
                  m.kind === "absence_response"
                ) {
                  return null;
                }
                if (m.kind !== "text") {
                  return (
                    <ChangeRequestCard
                      key={m.id}
                      message={m}
                      userId={userId}
                      own={own}
                    />
                  );
                }
                return (
                  <TextBubble
                    key={m.id}
                    content={m.content}
                    createdAt={new Date(m.created_at)}
                    own={own}
                    status={statusOf(m)}
                    edited={m.edited_at != null}
                    deleted={m.deleted_at != null}
                    actions={own ? actionsFor(m) : []}
                  />
                );
              })}
              {pending ? (
                <TextBubble
                  content={pending}
                  createdAt={new Date()}
                  own
                  status="sending"
                />
              ) : null}
            </div>
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-3 border-t border-border px-4 pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gold">Modifica messaggio</p>
            <p className="truncate text-xs text-t3">{editing.content}</p>
          </div>
          <button
            type="button"
            aria-label="Annulla la modifica"
            onClick={() => {
              setEditing(null);
              setText("");
              setSendError(null);
            }}
            className="focus-gold rounded-lg px-2 py-1 text-sm text-t3 hover:bg-bg-2"
          >
            ✕
          </button>
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scrivi un messaggio…"
        />
        <Button
          type="submit"
          variant="gold"
          disabled={!text.trim() || send.isPending || edit.isPending}
        >
          {editing ? "Salva" : "Invia"}
        </Button>
      </form>
      {sendError ? (
        <p className="px-4 pb-3 text-xs text-error">{sendError}</p>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Eliminare il messaggio?"
          message="Sparirà per tutti e due."
          confirmLabel="Elimina"
          destructive
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                if (editing?.id === deleting.id) {
                  setEditing(null);
                  setText("");
                }
                setDeleting(null);
              },
              onError: (err) => {
                setDeleting(null);
                setSendError(userErrorMessage(err));
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function TextBubble({
  content,
  createdAt,
  own,
  status,
  edited = false,
  deleted = false,
  actions = [],
}: {
  content: string;
  createdAt: Date;
  own: boolean;
  status: MessageStatus | null;
  edited?: boolean;
  deleted?: boolean;
  actions?: MoreMenuItem[];
}) {
  return (
    <div
      className={cn(
        "group flex max-w-[70%] items-start gap-1",
        own ? "flex-row-reverse self-end" : "self-start"
      )}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl px-3.5 py-2.5",
          own
            ? "rounded-br-md bg-gold-fill text-gold-ink"
            : "rounded-bl-md bg-bg-2 text-t1"
        )}
      >
        <p
          className={cn(
            "text-sm whitespace-pre-wrap",
            deleted && "italic opacity-70"
          )}
        >
          {deleted ? DELETED_TEXT : content}
        </p>
        <div className="mt-1 flex items-center justify-end gap-1">
          <span
            className={cn(
              "font-mono text-[10px] opacity-70",
              own ? "text-gold-ink" : "text-t4"
            )}
          >
            {edited && !deleted ? "Modificato · " : ""}
            {toTimeString(createdAt)}
          </span>
          {status ? <MessageTicks status={status} /> : null}
        </div>
      </div>
      {actions.length > 0 ? (
        // Il «⋯» compare al passaggio del mouse (o col focus da tastiera).
        <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <MoreMenu items={actions} label="Azioni sul messaggio" />
        </div>
      ) : null}
    </div>
  );
}
