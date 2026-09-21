import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { BADGE_STALE_TIME } from "@/lib/queryClient";
import {
  getNotificationsPage,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationCursor,
} from "./api";

export function useNotifications(userId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: qk.notifications.list(userId ?? ""),
    queryFn: ({ pageParam }) =>
      getNotificationsPage(userId as string, pageParam),
    initialPageParam: null as NotificationCursor | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < NOTIFICATIONS_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { created_at: last.created_at, id: last.id };
    },
    enabled: !!userId,
  });
  return { ...query, data: query.data?.pages.flat() };
}

/** Conteggio non letti per il badge della campanella. */
export function useUnreadCount(userId: string | undefined) {
  return useQuery({
    queryKey: qk.notifications.unread(userId ?? ""),
    queryFn: () => getUnreadCount(userId as string),
    enabled: !!userId,
    staleTime: BADGE_STALE_TIME,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
}

export function useMarkAllNotificationsRead(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
}
