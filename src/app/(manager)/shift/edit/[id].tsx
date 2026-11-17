import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useShift } from "@/features/shifts/hooks";
import { InternalShiftEditForm } from "@/features/assignments/InternalShiftEditForm";
import { useColors } from "@/lib/theme";

export default function EditShiftScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const shiftQuery = useShift(id);
  const shift = shiftQuery.data ?? null;

  if (shiftQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-0">
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  if (shiftQuery.isError) {
    return (
      <View className="flex-1 justify-center bg-bg-0 px-6">
        <QueryError onRetry={() => shiftQuery.refetch()} />
      </View>
    );
  }

  if (!shift) {
    return (
      <View className="flex-1 bg-bg-0">
        <EmptyState
          title="Turno non trovato"
          subtitle="Questo turno non è più disponibile."
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6">
        <ScreenHeader eyebrow="Turno" title="Modifica turno" />
      </View>
      <InternalShiftEditForm shift={shift} />
    </View>
  );
}
