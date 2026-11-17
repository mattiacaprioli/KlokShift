import { Stack } from "expo-router";
import { useColors } from "@/lib/theme";

export default function WaiterLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg0 },
        headerTintColor: colors.t1,
        contentStyle: { backgroundColor: colors.bg0 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="shift/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="storico" options={{ headerShown: false }} />
      <Stack.Screen name="profilo-edit" options={{ headerShown: false }} />
      <Stack.Screen name="documenti" options={{ headerShown: false }} />
      <Stack.Screen name="documento/new" options={{ headerShown: false }} />
      <Stack.Screen name="assenze" options={{ headerShown: false }} />
      <Stack.Screen name="assenza/new" options={{ headerShown: false }} />
      <Stack.Screen name="impostazioni" options={{ headerShown: false }} />
      <Stack.Screen name="cambia-password" options={{ headerShown: false }} />
      <Stack.Screen name="tutorial" options={{ headerShown: false }} />
      <Stack.Screen name="aiuto" options={{ headerShown: false }} />
      <Stack.Screen
        name="impostazioni-notifiche"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="notifiche" options={{ headerShown: false }} />
      <Stack.Screen name="inviti" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="nuovo-messaggio" options={{ headerShown: false }} />
    </Stack>
  );
}
