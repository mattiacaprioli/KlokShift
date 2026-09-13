import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export const MESSAGES_PAGE_SIZE = 30;

export type Conversation = Tables<"conversations">;
export type Message = Tables<"messages">;

/** Cursore keyset per la paginazione dei messaggi: (created_at, id) dell'ultimo (più vecchio) della pagina. */
export type MessageCursor = { created_at: string; id: string };

/**
 * Controparte della conversazione. La RLS di `profiles` non permette il join
 * diretto tra i partecipanti: il nome lo risolve `chat_counterpart` (DEFINER),
 * che è anche l'unica fonte usata dal trigger delle notifiche — così la lista
 * chat e la notifica non mostrano due mittenti diversi per lo stesso messaggio.
 *
 * Lato professionista viene da `get_waiter_public_card`. Lato gestore dipende da
 * quante sedi ha (20260913100200): con **una** è il nome del locale — si chatta
 * con "Trattoria da Mario", che è la UX giusta — con **più di una** è il nome del
 * titolare, perché il thread è uno per coppia e vale per tutte le sue sedi:
 * intestarlo a una delle tre sarebbe sbagliato due volte su tre.
 */
export type ChatCounterpart = {
  name: string;
  avatarUrl: string | null;
};

export type ConversationListItem = Conversation & {
  other: ChatCounterpart;
  lastMessage: Pick<Message, "content" | "created_at" | "sender_id"> | null;
  unreadCount: number;
};

export type ConversationDetail = Conversation & { other: ChatCounterpart };

/**
 * Controparte per OGNI conversazione (chiave = id conversazione). La stessa
 * persona può essere cameriere in una conversazione e proprietario di un locale
 * in un'altra: si risolve per lato della conversazione, non per profilo. La
 * risoluzione (nome/avatar) è delegata al DB (`get_chat_counterparts` →
 * `chat_counterpart`), stessa fonte del trigger `notify_on_new_message`.
 */
async function getCounterparts(
  conversations: Conversation[]
): Promise<Map<string, ChatCounterpart>> {
  const out = new Map<string, ChatCounterpart>();
  if (conversations.length === 0) return out;
  const { data, error } = await supabase.rpc("get_chat_counterparts", {
    p_conversations: conversations.map((c) => c.id),
  });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    out.set(row.conversation_id, {
      name: row.name ?? FALLBACK_COUNTERPART.name,
      avatarUrl: row.avatar_url,
    });
  }
  return out;
}

const FALLBACK_COUNTERPART: ChatCounterpart = { name: "Utente", avatarUrl: null };

/** Le conversazioni dell'utente con controparte, ultimo messaggio e non letti. */
export async function getConversations(
  userId: string
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversations")
    // !inner: escludi le conversazioni senza messaggi (create al tap di
    // "Contatta" ma mai iniziate) — non devono comparire nella lista.
    .select(
      "*, last:messages!inner(content, created_at, sender_id), unread:messages(count)"
    )
    .or(`waiter_id.eq.${userId},manager_id.eq.${userId}`)
    .order("created_at", { ascending: false, referencedTable: "last" })
    .limit(1, { referencedTable: "last" })
    .is("unread.read_at", null)
    .neq("unread.sender_id", userId);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const others = await getCounterparts(rows);
  return rows
    .map(({ last, unread, ...conversation }) => ({
      ...conversation,
      other: others.get(conversation.id) ?? FALLBACK_COUNTERPART,
      lastMessage: last[0] ?? null,
      unreadCount: unread[0]?.count ?? 0,
    }))
    .sort((a, b) =>
      (b.lastMessage?.created_at ?? b.created_at).localeCompare(
        a.lastMessage?.created_at ?? a.created_at
      )
    );
}

/** Singola conversazione con controparte (header del thread). */
export async function getConversation(
  conversationId: string
): Promise<ConversationDetail | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const others = await getCounterparts([data]);
  return {
    ...data,
    other: others.get(data.id) ?? FALLBACK_COUNTERPART,
  };
}

async function findConversation(
  waiterId: string,
  managerId: string
): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("waiter_id", waiterId)
    .eq("manager_id", managerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Una conversazione per coppia (indice unico waiter+manager). Niente upsert:
 * non va sovrascritto lo shift_id storico del primo contatto.
 */
export async function getOrCreateConversation(params: {
  waiterId: string;
  managerId: string;
  shiftId?: string | null;
}): Promise<Conversation> {
  const existing = await findConversation(params.waiterId, params.managerId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      waiter_id: params.waiterId,
      manager_id: params.managerId,
      shift_id: params.shiftId ?? null,
    })
    .select("*")
    .single();
  if (!error) return data;

  // Race sull'indice unico: un'altra sessione l'ha creata un attimo prima.
  if (error.code === "23505") {
    const retry = await findConversation(params.waiterId, params.managerId);
    if (retry) return retry;
  }
  throw new Error(error.message);
}

/**
 * Pagina di messaggi, dal più recente (per la FlatList inverted). Paginazione
 * **keyset** su (created_at, id): niente riga di confine duplicata come con
 * l'offset, e robusta anche se il thread cresce molto. `cursor = null` = prima
 * pagina.
 */
export async function getMessagesPage(
  conversationId: string,
  cursor: MessageCursor | null
): Promise<Message[]> {
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (cursor) {
    // (created_at, id) < (cursor.created_at, cursor.id) — tie-break su id.
    query = query.or(
      `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Il destinatario non può aggiornare read_at direttamente (policy "messages:
 * sender update"): passa dalla RPC DEFINER, che marca letta anche la notifica.
 */
export async function markConversationRead(
  conversationId: string
): Promise<void> {
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation: conversationId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Messaggi non letti totali (badge tab Messaggi).
 *
 * Era un `count: 'exact'` su tutta `messages` senza filtro per conversazione:
 * l'unico indice utile non era applicabile e la policy "messages: participants
 * read" veniva valutata riga per riga — su una schermata sempre montata. La RPC
 * fa il join su `conversations` e conta lì.
 *
 * L'utente non serve più come argomento: la funzione usa `auth.uid()`.
 */
export async function getChatUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_chat_unread_count");
  if (error) throw new Error(error.message);
  return data ?? 0;
}
