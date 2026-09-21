import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database";

export type Notification = Tables<"notifications">;
export const NOTIFICATIONS_PAGE_SIZE = 30;
export type NotificationCursor = { created_at: string; id: string };

/** L'utente vede solo le proprie notifiche (RLS "notifications: own only"). */
export async function getNotificationsPage(
  userId: string,
  cursor: NotificationCursor | null
): Promise<Notification[]> {
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(NOTIFICATIONS_PAGE_SIZE);
  if (cursor) {
    query = query.or(
      `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
