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
  MESSAGES_PAGE_SIZE,
  getChatUnreadCount,
  getConversation,
  getConversations,
  getMessagesPage,
  getWorkspaceContacts,
  openConversation,
  markConversationRead,
  sendMessage,
  type Message,
  type MessageCursor,
} from "./api";

export function useConversations(userId: string | undefined) {
  return useQuery({
    queryKey: qk.chat.conversations(userId ?? ""),
    queryFn: () => getConversations(userId as string),
    enabled: !!userId,
  });
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
