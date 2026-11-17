import { Stack } from "expo-router";
import { useColors } from "@/lib/theme";

export default function OnboardingLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg0 },
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
