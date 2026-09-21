import { useMemo, useState } from "react";
import { ActivityIndicator, SectionList } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { QueryError } from "@/components/ui/QueryError";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import type { ChatContact } from "./api";
import { useStartConversation, useWorkspaceContacts } from "./hooks";

/**
 * «Nuovo messaggio»: la rubrica dell'azienda.
 *
 * Una sezione per azienda, e l'intestazione compare **solo** a chi ne ha più di
 * una — per quasi tutti c'è un'azienda sola e il titolo sarebbe una riga di
 * rumore. Chi gestisce sta in cima: è la persona a cui si scrive per un
 * problema, e cercarla in mezzo a quaranta colleghi non ha senso.
 *
 * Aprire una conversazione non manda niente: la RPC la crea (o la ritrova) e si
 * naviga al thread. Una conversazione senza messaggi non compare nella lista —
 * `getConversationsPage` usa `messages!inner` — quindi tornare indietro senza
 * scrivere non lascia thread vuoti in giro.
 */
export function ContactPicker({
  userId,
  onOpened,
  bottomInset = 24,
}: {
  userId: string;
  onOpened: (conversationId: string) => void;
  bottomInset?: number;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const query = useWorkspaceContacts(userId);
  const start = useStartConversation();

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = (query.data ?? []).filter(
      (c) =>
        !needle ||
        c.name.toLowerCase().includes(needle) ||
        (c.venues ?? "").toLowerCase().includes(needle)
    );
    const byWorkspace = new Map<string, ChatContact[]>();
    for (const row of rows) {
      const list = byWorkspace.get(row.workspaceName);
      if (list) list.push(row);
      else byWorkspace.set(row.workspaceName, [row]);
    }
    return [...byWorkspace.entries()].map(([title, data]) => ({
      title,
      data: data.sort((a, b) =>
        a.isManager === b.isManager
          ? a.name.localeCompare(b.name)
          : a.isManager
            ? -1
            : 1
      ),
    }));
  }, [query.data, filter]);

  const multiWorkspace = sections.length > 1;

  function open(contact: ChatContact) {
    setOpeningId(contact.memberId);
    start.mutate(
      { memberId: contact.memberId },
      {
        onSuccess: (conversation) => onOpened(conversation.id),
        onError: (e) => {
          setOpeningId(null);
          toast.show(userErrorMessage(e), "error");
        },
      }
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 justify-center px-6">
        <QueryError onRetry={() => query.refetch()} />
      </View>
    );
  }

  if (query.isLoading) {
    return <ActivityIndicator color="#EAB54C" style={{ marginTop: 40 }} />;
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(c) => c.memberId}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View className="pb-3">
          <Input
            value={filter}
            onChangeText={setFilter}
            placeholder="Cerca una persona…"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      }
      renderSectionHeader={({ section }) =>
        multiWorkspace ? (
          <Text className="pb-2 pt-3 font-mono text-[11px] uppercase tracking-widest text-t4">
            {section.title}
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => open(item)}
          disabled={openingId !== null}
          className="flex-row items-center gap-3 rounded-3xl border border-border-2 bg-bg-card p-4"
        >
          <Avatar uri={item.avatarUrl ?? undefined} name={item.name} size={44} />
          <View className="flex-1">
            <Text className="text-base font-sans-bold text-t1" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="mt-0.5 text-[13px] text-t3" numberOfLines={1}>
              {item.isManager ? "Gestione" : (item.venues ?? "Organico")}
            </Text>
          </View>
          {openingId === item.memberId ? (
            <ActivityIndicator color="#EAB54C" />
          ) : null}
        </Pressable>
      )}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: bottomInset,
        gap: 10,
        flexGrow: 1,
      }}
      ListEmptyComponent={
        <View className="flex-1 justify-center">
          <EmptyState
            title={filter ? "Nessun risultato" : "Nessuno da contattare"}
            subtitle={
              filter
                ? "Prova con un altro nome."
                : "Qui compaiono le persone delle aziende in cui lavori."
            }
          />
        </View>
      }
    />
  );
}
