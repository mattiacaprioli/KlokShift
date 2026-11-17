import { Stack } from "expo-router";
import { useColors } from "@/lib/theme";

export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg0 },
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="signup-account" />
    </Stack>
  );
}
