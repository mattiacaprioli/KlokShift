import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { NotificationList } from "@/features/notifications/NotificationList";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/features/notifications/hooks";
import type { Notification } from "@/features/notifications/api";
import { routeForNotification } from "@/features/notifications/routing";
import { useAuth } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/usePullToRefresh";

export default function WaiterNotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session!.user.id;

  const query = useNotifications(userId);
  const items = query.data ?? [];
  const pull = usePullToRefresh(query.refetch);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead(userId);
  const unread = useUnreadCount(userId).data ?? 0;
  const hasUnread = unread > 0;

  const onOpen = (n: Notification) => {
    if (n.read_at == null) markRead.mutate(n.id);
    const href = routeForNotification("waiter", n.type, n.related_id);
    if (href) router.push(href);
  };

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-2">
        <ScreenHeader eyebrow="Account" title="Notifiche" />
      </View>
      <NotificationList
        notifications={items}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        onOpen={onOpen}
        onMarkAll={() => markAll.mutate()}
        hasUnread={hasUnread}
        contentPaddingBottom={insets.bottom + 24}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </View>
  );
}
