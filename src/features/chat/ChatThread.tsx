import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Pressable, Text, TextInput, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { QueryError } from "@/components/ui/QueryError";
import { ChatHeaderSkeleton, MessageSkeleton } from "@/components/ui/Skeleton";
import { userErrorMessage } from "@/lib/errors";
import { toTimeString } from "@/lib/format";
import { useKeyboardVisible } from "@/lib/useKeyboardVisible";
import { useToast } from "@/providers/Toast";
import { ChangeRequestCard } from "@/features/changeRequests/ChangeRequestCard";
import type { Message } from "./api";
import { DELETED_TEXT, canDelete, canEdit } from "./messageActions";
import { MessageTicks } from "./MessageTicks";
import type { MessageStatus } from "./messageStatus";
import { messageSchema } from "./schema";
import { useChatThread } from "./useChatThread";
import { useColors } from "@/lib/theme";

function MessageBubble({
  content,
  createdAt,
  own,
  status,
  edited = false,
  deleted = false,
  onLongPress,
}: {
  content: string;
  createdAt: Date;
  own: boolean;
  status: MessageStatus | null;
  edited?: boolean;
  deleted?: boolean;
  onLongPress?: () => void;
}) {
  const ink = own ? "text-gold-ink" : "text-t1";
  return (
    <Pressable
      onLongPress={onLongPress}
      disabled={!onLongPress}
      delayLongPress={350}
      className={cn(
        "max-w-[80%] rounded-2xl px-3.5 py-2.5",
        own
          ? "self-end rounded-br-md bg-gold-fill"
          : "self-start rounded-bl-md bg-bg-2"
      )}
    >
      <Text
        className={cn("text-[15px]", ink, deleted && "italic opacity-70")}
      >
        {deleted ? DELETED_TEXT : content}
      </Text>
      <View className="mt-1 flex-row items-center gap-1 self-end">
        <Text
          className={cn(
            "text-[10px] opacity-70",
            own ? "text-gold-ink" : "text-t4"
          )}
        >
          {edited && !deleted ? "Modificato · " : ""}
          {toTimeString(createdAt)}
        </Text>
        {status ? <MessageTicks status={status} /> : null}
      </View>
    </Pressable>
  );
}

function ActionRow({
  label,
  destructive = false,
  onPress,
}: {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-2xl border border-border-2 bg-bg-card px-4 py-3.5"
    >
      <Text
        className={cn(
          "text-base font-sans-bold",
          destructive ? "text-error" : "text-t1"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type Props = {
  conversationId: string;
  userId: string;
};

/** Thread di chat 1:1, condiviso tra le schermate cameriere e ristoratore. */
export function ChatThread({ conversationId, userId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const keyboardVisible = useKeyboardVisible();

  // Messaggi, realtime, mark-read e validazione dell'invio stanno nell'hook
  // condiviso con la dashboard web: qui resta solo la UI.
  const {
    conversation,
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

  // Modifica ed elimina: il messaggio tenuto premuto, quello in modifica nel
  // composer e quello da confermare per l'eliminazione.
  const [selected, setSelected] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  /** Cosa aprire quando il pannello ha finito di chiudersi (iOS, due Modal). */
  const afterSheet = useRef<"edit" | "delete" | null>(null);
  const pick = useRef<Message | null>(null);

  const canSend =
    text.trim().length > 0 && !send.isPending && !edit.isPending;

  const onSaveEdit = (message: Message) => {
    const parsed = messageSchema.safeParse({ content: text });
    if (!parsed.success) {
      toast.show(parsed.error.issues[0].message, "error");
      return;
    }
    edit.mutate(
      { id: message.id, content: parsed.data.content },
      {
        onSuccess: () => {
          setEditing(null);
          setText("");
        },
        onError: (err) => toast.show(userErrorMessage(err), "error"),
      }
    );
  };

  const onSend = () => {
    if (editing) {
      onSaveEdit(editing);
      return;
    }
    const draft = text;
    // Come su WhatsApp il testo lascia subito il composer e diventa la bolla
    // con l'orologio; se l'invio fallisce torna dov'era.
    const invalid = submit(draft, {
      onError: () => {
        setText((current) => (current === "" ? draft : current));
        toast.show("Messaggio non inviato. Riprova.", "error");
      },
    });
    if (invalid) toast.show(invalid, "error");
    else setText("");
  };

  if (notFound) {
    return (
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="h-12 w-12 items-center justify-center rounded-full border border-border-2 bg-bg-2"
          >
            <Icon name="chevL" size={22} color={colors.t1} />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title="Conversazione non trovata"
            subtitle="Questa conversazione non è più disponibile."
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      {/* "padding" anche su Android: con l'edge-to-edge di SDK 54+ adjustResize
          non ridimensiona più la finestra, quindi senza behavior la tastiera
          copre composer e ultimi messaggi. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2"
          >
            <Icon name="chevL" size={18} color={colors.t1} />
          </Pressable>
          {other ? (
            <>
              <Avatar
                uri={other.avatarUrl ?? undefined}
                name={other.name}
                size={40}
              />
              <View className="flex-1">
                <Text className="text-lg font-sans-bold text-t1" numberOfLines={1}>
                  {other.name}
                </Text>
                {other.subtitle ? (
                  <Text className="text-xs text-t4" numberOfLines={1}>
                    {other.subtitle}
                  </Text>
                ) : null}
              </View>
            </>
          ) : conversation.isLoading ? (
            <ChatHeaderSkeleton />
          ) : (
            // Placeholder neutro finché non arriva la controparte (niente "?").
            <>
              <View className="h-10 w-10 rounded-full bg-bg-2" />
              <View className="h-4 w-40 rounded-full bg-bg-2" />
            </>
          )}
        </View>

        {query.isError ? (
          <View className="flex-1 justify-center px-6">
            <QueryError onRetry={() => query.refetch()} />
          </View>
        ) : query.isLoading || (conversation.isLoading && messages.length === 0) ? (
          <MessageSkeleton />
        ) : (
          <FlatList
            // Inverted solo con dati: ListEmptyComponent altrimenti va a testa in giù.
            inverted={messages.length > 0}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) =>
              // Le righe di servizio del cambio turno non sono testo: portano
              // un `request_id` e si rendono come card con i bottoni di chi
              // deve decidere. Il `content` resta la frase di ripiego, ed è
              // quello che la card mostra come motivo. Le assenze in chat non
              // ci sono più (31/10): una riga rimasta non si mostra.
              item.kind === "text" ? (
                <MessageBubble
                  content={item.content}
                  createdAt={new Date(item.created_at)}
                  own={item.sender_id === userId}
                  status={statusOf(item)}
                  edited={item.edited_at != null}
                  deleted={item.deleted_at != null}
                  onLongPress={
                    canDelete(item, userId, new Date())
                      ? () => setSelected(item)
                      : undefined
                  }
                />
              ) : item.kind === "absence_request" ||
                item.kind === "absence_response" ? null : (
                <ChangeRequestCard
                  message={item}
                  userId={userId}
                  own={item.sender_id === userId}
                />
              )
            }
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              gap: 8,
              flexGrow: 1,
            }}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) {
                query.fetchNextPage();
              }
            }}
            // In una lista invertita l'header sta in fondo: è il posto del
            // messaggio che sta partendo.
            ListHeaderComponent={
              pending ? (
                <View style={{ marginBottom: messages.length > 0 ? 8 : 0 }}>
                  <MessageBubble
                    content={pending}
                    createdAt={new Date()}
                    own
                    status="sending"
                  />
                </View>
              ) : null
            }
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator
                  color={colors.gold}
                  style={{ marginVertical: 16 }}
                />
              ) : null
            }
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center px-8">
                <Text className="text-center text-base font-sans-bold text-t1">
                  Inizia la conversazione
                </Text>
                <Text className="mt-1 text-center text-sm text-t3">
                  {other
                    ? `Scrivi il primo messaggio a ${other.name}.`
                    : "Scrivi il primo messaggio."}
                </Text>
              </View>
            }
          />
        )}

        {editing ? (
          <View className="flex-row items-center gap-3 border-t border-border px-5 pt-3">
            <Icon name="pencil" size={16} color={colors.gold} />
            <View className="flex-1">
              <Text className="text-xs font-sans-bold text-gold">
                Modifica messaggio
              </Text>
              <Text className="text-xs text-t3" numberOfLines={1}>
                {editing.content}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setEditing(null);
                setText("");
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Annulla la modifica"
            >
              <Icon name="close" size={18} color={colors.t3} />
            </Pressable>
          </View>
        ) : null}
        <View
          className={cn(
            "flex-row items-end gap-2 px-4 pt-3",
            !editing && "border-t border-border"
          )}
          // A tastiera aperta l'inset inferiore è coperto: tenerlo lascerebbe
          // un buco vuoto tra composer e tastiera.
          style={{ paddingBottom: keyboardVisible ? 12 : insets.bottom + 12 }}
        >
          <TextInput
            className="max-h-28 flex-1 rounded-[14px] border border-border bg-bg-1 px-4 py-3 font-sans text-[16px] text-t1"
            placeholder="Scrivi un messaggio…"
            placeholderTextColor={colors.t4}
            multiline
            value={text}
            onChangeText={setText}
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className={cn(
              "h-12 w-12 items-center justify-center rounded-full",
              canSend ? "bg-gold-fill" : "border border-border-2 bg-bg-2"
            )}
          >
            <Icon
              name={editing ? "check" : "send"}
              size={20}
              color={canSend ? colors.goldInk : colors.t4}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <BottomSheet
        visible={selected != null}
        onClose={() => setSelected(null)}
        onClosed={() => {
          const next = afterSheet.current;
          afterSheet.current = null;
          if (!next || !pick.current) return;
          if (next === "edit") {
            setEditing(pick.current);
            setText(pick.current.content);
          } else {
            setDeleting(pick.current);
          }
          pick.current = null;
        }}
      >
        <View className="gap-2">
          {selected && canEdit(selected, userId, new Date()) ? (
            <ActionRow
              label="Modifica"
              onPress={() => {
                afterSheet.current = "edit";
                pick.current = selected;
                setSelected(null);
              }}
            />
          ) : null}
          <ActionRow
            label="Elimina"
            destructive
            onPress={() => {
              afterSheet.current = "delete";
              pick.current = selected;
              setSelected(null);
            }}
          />
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={deleting != null}
        title="Eliminare il messaggio?"
        message="Sparirà per tutti e due."
        confirmLabel="Elimina"
        destructive
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
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
              toast.show(userErrorMessage(err), "error");
            },
          });
        }}
      />
    </View>
  );
}
