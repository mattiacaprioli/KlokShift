import { Stack } from "expo-router";

export default function ManagerLayout() {
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
      <Stack.Screen name="venue/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="shift/new" options={{ headerShown: false }} />
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
      <Stack.Screen name="assenze" options={{ headerShown: false }} />
      <Stack.Screen name="storico" options={{ headerShown: false }} />
      <Stack.Screen name="pro" options={{ headerShown: false }} />
      <Stack.Screen name="ruoli" options={{ headerShown: false }} />
      <Stack.Screen name="cameriere/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="notifiche" options={{ headerShown: false }} />
      <Stack.Screen name="profilo-edit" options={{ headerShown: false }} />
      <Stack.Screen name="impostazioni" options={{ headerShown: false }} />
      <Stack.Screen name="team" options={{ headerShown: false }} />
      <Stack.Screen name="team/new" options={{ headerShown: false }} />
      <Stack.Screen name="tutorial" options={{ headerShown: false }} />
      <Stack.Screen
        name="impostazioni-notifiche"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
