import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useConversations, useStartConversation } from "@/features/chat/hooks";
import { useChatThread } from "@/features/chat/useChatThread";
import { useOwnerPeople } from "@/features/staff/hooks";
import { userErrorMessage } from "@/lib/errors";
import { timeAgo, toTimeString } from "@/lib/format";
import { cn } from "@/lib/cn";
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
  Spinner,
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
  const { data, isPending, isError, error } = useConversations(userId);

  if (isPending) return <Spinner />;
  if (isError) return <QueryError error={error} />;

  const conversations = data ?? [];

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
        <StaffPicker
          managerId={userId}
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
          detail="Scegli “Nuovo messaggio” per scrivere a una persona del tuo organico, oppure parti dalla sua scheda nello Staff."
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
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/chat/${c.id}`)}
                  className={cn(
                    "focus-gold shrink-0 rounded-2xl border p-3 text-left transition",
                    active
                      ? "border-border-gold bg-gold/10"
                      : "border-border-2 bg-bg-card hover:bg-bg-1"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-t1">
                      {c.other.name}
                    </span>
                    {c.lastMessage ? (
                      <span className="shrink-0 text-[11px] text-t4">
                        {timeAgo(c.lastMessage.created_at)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-t3">
                      {c.lastMessage
                        ? `${mine ? "Tu: " : ""}${c.lastMessage.content}`
                        : "Nessun messaggio"}
                    </span>
                    {c.unreadCount > 0 ? (
                      <span className="shrink-0 rounded-full bg-gold px-1.5 text-[11px] font-bold text-gold-ink">
                        {c.unreadCount > 9 ? "9+" : c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
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
 * Scelta del destinatario per una chat nuova. L'elenco sono le **persone del
 * titolare**, non l'organico della sede attiva, e solo quelle con un account
 * (senza, non c'è nessuno dall'altra parte).
 *
 * Il perimetro è il titolare perché il thread lo è: uno per coppia (dipendente,
 * titolare), non uno per sede. Se qui si fermasse alla sede attiva, Giuseppe dalla
 * pagina di Roma non potrebbe scrivere a chi ha solo a Milano — pur avendo con lui
 * una conversazione già aperta.
 *
 * Chi ha già una conversazione resta in lista: riaprirla è lo stesso gesto, e
 * `getOrCreateConversation` non ne crea una seconda.
 */
function StaffPicker({
  managerId,
  onOpened,
}: {
  managerId: string;
  onOpened: (conversationId: string) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const startConversation = useStartConversation();
  const { data, isPending, isError, error } = useOwnerPeople(managerId);

  const linked = (data ?? []).filter((p) => p.waiter_id);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? linked.filter((p) => p.full_name.toLowerCase().includes(needle))
    : linked;

  function open(memberId: string, waiterId: string) {
    setOpeningId(memberId);
    startConversation.mutate(
      { waiterId, managerId },
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
        <Spinner />
      ) : isError ? (
        <QueryError error={error} />
      ) : linked.length === 0 ? (
        <p className="py-6 text-center text-xs text-t4">
          Nessuno nel tuo organico ha un account collegato: invitali dallo Staff
          per poterci scrivere.
        </p>
      ) : (
        <>
          {linked.length > 6 ? (
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
              {shown.map((person) => {
                const venuesLabel = person.memberships
                  .map((m) => m.venue?.name)
                  .filter((n): n is string => !!n)
                  .sort((a, b) => a.localeCompare(b, "it"))
                  .join(" · ");
                const allPending = person.memberships.every(
                  (m) => m.link_status === "pending"
                );
                return (
                  <button
                    key={person.id}
                    disabled={startConversation.isPending}
                    onClick={() => open(person.id, person.waiter_id as string)}
                    className="focus-gold flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-bg-1 disabled:opacity-40"
                  >
                    <Avatar url={person.waiter?.avatar_url} name={person.full_name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-t1">
                        {person.full_name}
                      </span>
                      {/* Le sedi e non i ruoli: qui serve sapere "chi è questo",
                          e con più locali la sede lo dice meglio del ruolo. */}
                      <span className="block truncate text-xs text-t4">
                        {venuesLabel || "Nessuna sede"}
                      </span>
                    </span>
                    {allPending ? (
                      <Pill tone="warning">Invito in attesa</Pill>
                    ) : null}
                    <span className="shrink-0 text-xs text-gold">
                      {openingId === person.id && startConversation.isPending
                        ? "Apertura…"
                        : "Scrivi"}
                    </span>
                  </button>
                );
              })}
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
  const { query, messages, other, notFound, send, submit } = useChatThread(
    conversationId,
    userId
  );

  // I messaggi arrivano dal più recente: si mostrano invertiti, e si scende in
  // fondo a ogni nuovo arrivo.
  const ordered = [...messages].reverse();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

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
    const invalid = submit(text, {
      onSuccess: () => setText(""),
      onError: () => setSendError("Messaggio non inviato. Riprova."),
    });
    setSendError(invalid);
  }

  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-border-2 bg-bg-card">
      <header className="border-b border-border px-5 py-3">
        <p className="text-sm font-semibold text-t1">
          {other?.name ?? " "}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {query.isError ? (
          <QueryError error={query.error} />
        ) : query.isLoading ? (
          <Spinner />
        ) : ordered.length === 0 ? (
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
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[70%] rounded-2xl px-3.5 py-2.5",
                      own
                        ? "self-end rounded-br-md bg-gold text-gold-ink"
                        : "self-start rounded-bl-md bg-bg-2 text-t1"
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    <p
                      className={cn(
                        "mt-1 text-right font-mono text-[10px] opacity-70",
                        own ? "text-gold-ink" : "text-t4"
                      )}
                    >
                      {toTimeString(new Date(m.created_at))}
                    </p>
                  </div>
                );
              })}
            </div>
            <div ref={bottomRef} />
          </>
        )}
      </div>

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
          disabled={!text.trim() || send.isPending}
        >
          Invia
        </Button>
      </form>
      {sendError ? (
        <p className="px-4 pb-3 text-xs text-error">{sendError}</p>
      ) : null}
    </div>
  );
}
