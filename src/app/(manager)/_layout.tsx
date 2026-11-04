import { Stack } from "expo-router";
import { QueryError } from "@/components/ui/QueryError";
import { resolveLegalGate } from "@/features/legal/gate";
import { useAuth } from "@/lib/auth";
import { LegalAcceptanceScreen, LegalExitActions } from "@/features/legal/LegalAcceptanceScreen";
import { usePendingLegalAcceptances } from "@/features/legal/hooks";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { View } from "@/tw";

export default function ManagerLayout() {
  const { session } = useAuth();
  const { workspaceId } = useOwnerVenues();
  const pending = usePendingLegalAcceptances(session?.user.id);

  // Termini e DPA non accettati fermano la gestione dell'azienda in uso (app e
  // dashboard), mai il lavoro: finché la risposta non c'è, non si sblocca niente.
  const legal = resolveLegalGate(pending, workspaceId);
  if (legal.status === "loading") return <View className="flex-1 bg-bg-0" />;
  if (legal.status === "error") {
    return (
      <View className="flex-1 justify-center gap-3 bg-bg-0 px-6">
        <QueryError onRetry={() => void pending.refetch()} />
        <LegalExitActions />
      </View>
    );
  }
  if (legal.gate.blocked) return <LegalAcceptanceScreen gate={legal.gate} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0C0907" },
        headerTintColor: "#F8F4ED",
        headerTitleStyle: { color: "#F8F4ED" },
        contentStyle: { backgroundColor: "#0C0907" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="venue/new" options={{ headerShown: false }} />
      {/* Si esce solo coi due bottoni: un gesto indietro riporterebbe al form
          della sede appena salvata. */}
      <Stack.Screen
        name="prova"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="venue/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="shift/new" options={{ headerShown: false }} />
      <Stack.Screen name="shift/record" options={{ headerShown: false }} />
      <Stack.Screen name="shift/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="shift/edit/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/new" options={{ headerShown: false }} />
      <Stack.Screen name="staff/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="staff/documento/new"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="staff/assenza/new" options={{ headerShown: false }} />
      <Stack.Screen name="ore" options={{ headerShown: false }} />
      <Stack.Screen name="codici-consulente" options={{ headerShown: false }} />
      <Stack.Screen name="assenze" options={{ headerShown: false }} />
      <Stack.Screen name="storico" options={{ headerShown: false }} />
      <Stack.Screen name="sedi" options={{ headerShown: false }} />
      <Stack.Screen name="ruoli" options={{ headerShown: false }} />
      <Stack.Screen name="notifiche" options={{ headerShown: false }} />
      <Stack.Screen name="profilo-edit" options={{ headerShown: false }} />
      <Stack.Screen name="impostazioni" options={{ headerShown: false }} />
      <Stack.Screen name="cambia-password" options={{ headerShown: false }} />
      <Stack.Screen name="team" options={{ headerShown: false }} />
      <Stack.Screen name="team/new" options={{ headerShown: false }} />
      <Stack.Screen name="tutorial" options={{ headerShown: false }} />
      <Stack.Screen name="aiuto" options={{ headerShown: false }} />
      <Stack.Screen
        name="impostazioni-notifiche"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="nuovo-messaggio" options={{ headerShown: false }} />
    </Stack>
  );
}
