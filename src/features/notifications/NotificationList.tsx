import { ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { timeAgo } from "@/lib/format";
import type { Enums } from "@/types/database";
import type { Notification } from "./api";

const TYPE_ICON: Record<Enums<"notification_type">, IconName> = {
  new_message: "message",
  shift_assigned: "calendar",
  shift_cancelled: "alert",
  shift_updated: "clock",
  shift_unassigned: "close",
  staff_invite: "users",
  staff_linked: "users",
  staff_response: "users",
  staff_removed: "close",
  shift_change_request: "users",
  shift_change_response: "check",
  shift_declined: "alert",
  team_linked: "shield",
  team_joined: "shield",
  team_removed: "close",
  absence_request: "calendar",
  absence_response: "check",
  absence_sick: "alert",
};

type Props = {
  notifications: Notification[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onOpen: (n: Notification) => void;
  onMarkAll?: () => void;
  hasUnread?: boolean;
  contentPaddingBottom?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
};

export function NotificationList({
  notifications,
  refreshing,
  onRefresh,
  onOpen,
  onMarkAll,
  hasUnread,
  contentPaddingBottom = 24,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: Props) {
  const header = hasUnread && onMarkAll ? (
    <Pressable onPress={onMarkAll} hitSlop={6} className="mb-2 self-end">
      <Text className="font-sans-semibold text-sm text-gold">
        Segna tutte come lette
      </Text>
    </Pressable>
  ) : null;

  return (
    <FlatList
      className="flex-1 bg-bg-0"
      data={notifications}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: contentPaddingBottom,
        gap: 10,
      }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            tintColor="#EAB54C"
            refreshing={!!refreshing}
            onRefresh={onRefresh}
          />
        ) : undefined
      }
      ListHeaderComponent={header}
      ListEmptyComponent={
        <EmptyState
          className="mt-16"
          title="Nessuna notifica"
          subtitle="Ti avviseremo qui sui tuoi turni e sui messaggi."
        />
      }
      renderItem={({ item: n }) => {
        const unread = n.read_at == null;
        return (
          <Pressable
            key={n.id}
            onPress={() => onOpen(n)}
            className={cn(
              "flex-row gap-3 rounded-2xl border p-4",
              unread ? "border-border-2 bg-bg-1" : "border-border bg-bg-0"
            )}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
              <Icon name={TYPE_ICON[n.type]} size={18} color="#EAB54C" />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-sm text-t1">{n.title}</Text>
              <Text className="mt-0.5 font-sans text-sm text-t2">{n.body}</Text>
              <Text className="mt-1 font-sans text-xs text-t3">
                {timeAgo(n.created_at)}
              </Text>
            </View>
            {unread ? (
              <View className="mt-1 h-2 w-2 rounded-full bg-gold" />
            ) : null}
          </Pressable>
        );
      }}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) onLoadMore?.();
      }}
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator color="#EAB54C" style={{ marginTop: 12 }} />
        ) : null
      }
    />
  );
}
