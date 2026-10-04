import { FloatingTabBar } from "@/components/nav/FloatingTabBar";
import type { IconName } from "@/components/ui/Icon";
import { usePendingAbsenceCount } from "@/features/absences/hooks";
import { useChatUnreadCount } from "@/features/chat/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";
import { Tabs } from "expo-router";

const ICONS: Record<string, IconName> = {
  index: "home",
  turni: "calendar",
  messaggi: "message",
  staff: "users",
  profilo: "user",
};

export default function ManagerTabsLayout() {
  const { session } = useAuth();
  const { canAny } = useOwnerVenues();
  const unread = useChatUnreadCount(session?.user.id).data ?? 0;

  const showStaff = canAny("can_manage_staff");
  // Le assenze non hanno una tab: stanno in Staff, e il badge dice da qualunque
  // schermata che c'è una richiesta che aspetta.
  const pendingAbsences = usePendingAbsenceCount(showStaff);

  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar
          {...props}
          icons={ICONS}
          badges={{ messaggi: unread, staff: pendingAbsences }}
        />
      )}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="turni" options={{ title: "Turni" }} />
      {/* `href: null` toglie la voce dalla barra **e** la rotta dal navigatore:
          è il modo di Expo Router di nascondere una tab, non un `display:none`
          che lascerebbe la schermata raggiungibile da un deep link. */}
      {/* Per tutti: una conversazione è fra due persone dell'azienda e la RLS
          fa leggere a ciascuno solo le proprie (vedi AGENTS.md, «La chat»). */}
      <Tabs.Screen name="messaggi" options={{ title: "Messaggi" }} />
      <Tabs.Screen
        name="staff"
        options={{ title: "Staff", href: showStaff ? undefined : null }}
      />
      <Tabs.Screen name="profilo" options={{ title: "Profilo" }} />
    </Tabs>
  );
}
