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
 * Sempre **una persona** per nome, da entrambi i lati (20260920001800): un
 * messaggio lo scrive qualcuno, e il dipendente non deve rispondere a un
 * marchio. Lato gestione il `subtitle` porta il luogo — la sede se l'azienda ne
 * ha una sola, altrimenti l'azienda, perché il thread è uno per coppia e vale
 * per tutte le sedi: intestarlo a una delle tre sarebbe sbagliato due volte su
 * tre. Lato professionista è `null`: non c'è insegna da mostrare.
 */
export type ChatCounterpart = {
  name: string;
  subtitle: string | null;
  avatarUrl: string | null;
};

export type ConversationListItem = Conversation & {
  other: ChatCounterpart;
  lastMessage: Pick<Message, "content" | "created_at" | "sender_id"> | null;
  unreadCount: number;
};

export type ConversationDetail = Conversation & { other: ChatCounterpart };
export const CONVERSATIONS_PAGE_SIZE = 30;
export type ConversationCursor = { last_message_at: string; id: string };

/**
 * Controparte per OGNI conversazione (chiave = id conversazione). La stessa
 * persona può essere cameriere in una conversazione e proprietario di una sede
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
      subtitle: row.subtitle,
      avatarUrl: row.avatar_url,
    });
  }
  return out;
}

const FALLBACK_COUNTERPART: ChatCounterpart = {
  name: "Utente",
  subtitle: null,
  avatarUrl: null,
};

/** Le conversazioni dell'utente con controparte, ultimo messaggio e non letti. */
export async function getConversationsPage(
  userId: string,
  cursor: ConversationCursor | null
): Promise<ConversationListItem[]> {
  let query = supabase
    .from("conversations")
    // !inner: escludi le conversazioni senza messaggi (create al tap di
    // "Contatta" ma mai iniziate) — non devono comparire nella lista.
    .select(
      "*, last:messages!inner(content, created_at, sender_id), unread:messages(count)"
    )
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("created_at", { ascending: false, referencedTable: "last" })
    .limit(1, { referencedTable: "last" })
    .is("unread.read_at", null)
    .neq("unread.sender_id", userId)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CONVERSATIONS_PAGE_SIZE);
  if (cursor) {
    query = query.or(
      `last_message_at.lt."${cursor.last_message_at}",and(last_message_at.eq."${cursor.last_message_at}",id.lt.${cursor.id})`
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const others = await getCounterparts(rows);
  return rows.map(({ last, unread, ...conversation }) => ({
    ...conversation,
    other: others.get(conversation.id) ?? FALLBACK_COUNTERPART,
    lastMessage: last[0] ?? null,
    unreadCount: unread[0]?.count ?? 0,
  }));
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

/**
 * Chi si vuole raggiungere: una **persona qualsiasi** della stessa azienda
 * (`memberId` = `workspace_members.id`) oppure, senza sapere chi sia, il
 * titolare dell'azienda (`workspaceId`). L'altra estremità la sceglie il DB.
 */
export type OpenConversationInput =
  | { memberId: string; workspaceId?: undefined }
  | { workspaceId: string; memberId?: undefined };

/**
 * Apre la conversazione della coppia, o la ritrova: una per coppia di persone
 * dentro un'azienda, e a crearla o riaprirla ci pensa la RPC
 * `open_conversation`, che controlla anche che i due lavorino davvero insieme —
 * e, fra due dipendenti, che l'azienda non abbia spento la chat fra colleghi
 * (`chat_disabled`).
 */
export async function openConversation(
  input: OpenConversationInput
): Promise<Conversation> {
  const { data: id, error } = await supabase.rpc(
    "open_conversation",
    input.memberId
      ? { p_member: input.memberId }
      : { p_workspace: input.workspaceId }
  );
  if (error) throw new Error(error.message);
  const { data, error: readError } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!data) throw new Error("conversation_not_found");
  return data;
}

/**
 * Una persona raggiungibile in chat, come la mostra il «Nuovo messaggio».
 * `venues` sono le sedi in cui lavora (serve a distinguere due Marco in
 * un'azienda con più sedi), `isManager` dice se gestisce — per tenere in cima
 * chi risponde delle cose.
 */
export type ChatContact = {
  memberId: string;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  avatarUrl: string | null;
  venues: string | null;
  isManager: boolean;
};

/**
 * La rubrica: tutte le persone raggiungibili, in tutte le aziende in cui si è
 * attivi. La RLS di `profiles` non lascia leggere i colleghi, quindi nome e
 * foto arrivano dalla RPC DEFINER `get_workspace_contacts`, che applica anche
 * l'interruttore `staff_can_chat` — spento, restano solo titolari e
 * collaboratori.
 */
export async function getWorkspaceContacts(): Promise<ChatContact[]> {
  const { data, error } = await supabase.rpc("get_workspace_contacts");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    memberId: row.member_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    name: row.name,
    avatarUrl: row.avatar_url,
    venues: row.venues,
    isManager: row.is_manager,
  }));
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
