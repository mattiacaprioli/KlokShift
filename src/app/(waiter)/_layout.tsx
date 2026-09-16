import { Stack } from "expo-router";

export default function WaiterLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0C0907" },
        headerTintColor: "#F8F4ED",
        contentStyle: { backgroundColor: "#0C0907" },
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
      <Stack.Screen name="esperienza/new" options={{ headerShown: false }} />
      <Stack.Screen name="esperienza/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="qr" options={{ headerShown: false }} />
      <Stack.Screen name="impostazioni" options={{ headerShown: false }} />
      <Stack.Screen
        name="impostazioni-notifiche"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="recensioni" options={{ headerShown: false }} />
      <Stack.Screen name="notifiche" options={{ headerShown: false }} />
      <Stack.Screen name="inviti" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
