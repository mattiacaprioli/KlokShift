import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { BADGE_STALE_TIME } from "@/lib/queryClient";
import {
  CONVERSATIONS_PAGE_SIZE,
  MESSAGES_PAGE_SIZE,
  getChatUnreadCount,
  getConversation,
  getConversationsPage,
  getMessagesPage,
  getWorkspaceContacts,
  openConversation,
  markConversationRead,
  sendMessage,
  editMessage,
  deleteMessage,
  type Conversation,
  type ConversationDetail,
  type Message,
  type MessageCursor,
  type ConversationCursor,
} from "./api";

export function useConversations(userId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: qk.chat.conversations(userId ?? ""),
    queryFn: ({ pageParam }) =>
      getConversationsPage(userId as string, pageParam),
    initialPageParam: null as ConversationCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < CONVERSATIONS_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { last_message_at: last.last_message_at!, id: last.id };
    },
    enabled: !!userId,
  });
  return { ...query, data: query.data?.pages.flat() };
}

/** Conversazione con controparte, per l'header del thread. */
export function useConversation(
  conversationId: string | undefined,
  userId: string | undefined
) {
  return useQuery({
    queryKey: qk.chat.conversation(conversationId ?? ""),
    queryFn: () => getConversation(conversationId as string),
    enabled: !!conversationId && !!userId,
  });
}

/** Conteggio non letti per il badge del tab Messaggi. */
export function useChatUnreadCount(userId: string | undefined) {
  return useQuery({
    queryKey: qk.chat.unread(userId ?? ""),
    queryFn: () => getChatUnreadCount(),
    enabled: !!userId,
    staleTime: BADGE_STALE_TIME,
  });
}

export function useMessagesInfinite(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: qk.chat.messages(conversationId ?? ""),
    queryFn: ({ pageParam }) =>
      getMessagesPage(conversationId as string, pageParam),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < MESSAGES_PAGE_SIZE) return undefined;
      const oldest = lastPage[lastPage.length - 1];
      return { created_at: oldest.created_at, id: oldest.id };
    },
    enabled: !!conversationId,
  });
}

/**
 * Inserisce un messaggio in testa alla prima pagina della cache del thread.
 * Dedupe per id: l'echo realtime e l'onSuccess della mutation sono idempotenti.
 */
export function appendMessageToCache(qc: QueryClient, message: Message) {
  const key = qk.chat.messages(message.conversation_id);
  const existing = qc.getQueryData<InfiniteData<Message[]>>(key);
  if (!existing) {
    // La query dei messaggi non è ancora in cache (INSERT realtime che corre
    // col primo fetch): invalida così il messaggio non va perso.
    qc.invalidateQueries({ queryKey: key });
    return;
  }
  if (existing.pages.some((page) => page.some((m) => m.id === message.id))) {
    return;
  }
  qc.setQueryData<InfiniteData<Message[]>>(key, {
    ...existing,
    pages: [[message, ...existing.pages[0]], ...existing.pages.slice(1)],
  });
}

/**
 * Un messaggio cambiato (in pratica: `read_at`, l'altro ha aperto il thread)
 * prende il posto della sua copia in cache. Spunte «visualizzato» in diretta.
 */
export function applyMessageUpdateToCache(qc: QueryClient, message: Message) {
  patchMessageInCache(qc, message.conversation_id, message.id, message);
}

/**
 * La conversazione cambiata (segnalibri «ricevuto», `last_message_at`) si
 * fonde nell'header del thread senza perdere la controparte. Spunte
 * «ricevuto» in diretta.
 */
export function applyConversationUpdateToCache(
  qc: QueryClient,
  row: Conversation
) {
  const key = qk.chat.conversation(row.id);
  const existing = qc.getQueryData<ConversationDetail | null>(key);
  if (!existing) return;
  qc.setQueryData<ConversationDetail>(key, { ...existing, ...row });
}

/**
 * Cambia in cache un messaggio dopo una modifica o un'eliminazione andata a
 * buon fine; l'altra persona lo riceve dal canale UPDATE del thread.
 */
function patchMessageInCache(
  qc: QueryClient,
  conversationId: string,
  id: string,
  patch: Partial<Message>
) {
  const key = qk.chat.messages(conversationId);
  const existing = qc.getQueryData<InfiniteData<Message[]>>(key);
  if (!existing) return;
  qc.setQueryData<InfiniteData<Message[]>>(key, {
    ...existing,
    pages: existing.pages.map((page) =>
      page.map((m) => (m.id === id ? { ...m, ...patch } : m))
    ),
  });
}

export function useEditMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      editMessage(id, content),
    onSuccess: (_data, { id, content }) => {
      patchMessageInCache(qc, conversationId, id, {
        content: content.trim(),
        edited_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: qk.chat.conversationsAll });
    },
  });
}

export function useDeleteMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMessage(id),
    onSuccess: (_data, id) => {
      patchMessageInCache(qc, conversationId, id, {
        content: "",
        deleted_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: qk.chat.conversationsAll });
    },
  });
}

export function useSendMessage(conversationId: string, userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      sendMessage(conversationId, userId, content),
    onSuccess: (message) => {
      appendMessageToCache(qc, message);
      qc.invalidateQueries({ queryKey: qk.chat.conversationsAll });
    },
  });
}

/** Segna letti in cache i messaggi ricevuti, così `hasUnread` non ri-scatta. */
function markReceivedReadInCache(
  qc: QueryClient,
  conversationId: string,
  userId: string
) {
  const key = qk.chat.messages(conversationId);
  const existing = qc.getQueryData<InfiniteData<Message[]>>(key);
  if (!existing) return;
  const now = new Date().toISOString();
  qc.setQueryData<InfiniteData<Message[]>>(key, {
    ...existing,
    pages: existing.pages.map((page) =>
      page.map((m) =>
        m.sender_id !== userId && m.read_at == null ? { ...m, read_at: now } : m
      )
    ),
  });
}

export function useMarkConversationRead(conversationId: string, userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markConversationRead(conversationId),
    onSuccess: () => {
      markReceivedReadInCache(qc, conversationId, userId);
      qc.invalidateQueries({ queryKey: qk.chat.unread(userId) });
      qc.invalidateQueries({ queryKey: qk.chat.conversations(userId) });
      // La RPC marca letta anche la notifica 'new_message' della conversazione.
      qc.invalidateQueries({ queryKey: qk.notifications.all });
    },
  });
}

/** La rubrica del «Nuovo messaggio»: chi posso raggiungere, azienda per azienda. */
export function useWorkspaceContacts(userId: string | undefined) {
  return useQuery({
    queryKey: qk.chat.contacts(userId ?? ""),
    queryFn: getWorkspaceContacts,
    enabled: !!userId,
  });
}

/** Apre (o crea) la conversazione; la navigazione la fa lo screen chiamante. */
export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: openConversation,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.chat.conversationsAll }),
  });
}
