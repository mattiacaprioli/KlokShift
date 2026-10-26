import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { RecordPastShiftForm } from "@/features/assignments/RecordPastShiftForm";
import { RECORD_TITLE } from "@/features/shifts/recorded";
import { todayString } from "@/lib/format";

/** "YYYY-MM-DD" dal calendario dell'agenda, se si arriva da lì. */
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export default function RecordPastShiftScreen() {
  const insets = useSafeAreaInsets();
  const { date } = useLocalSearchParams<{ date?: string }>();
  // Un giorno futuro qui non ha senso: si parte da ieri, il caso più comune.
  const initialDate =
    date && DATE_PARAM.test(date) && date <= todayString()
      ? new Date(`${date}T00:00:00`)
      : undefined;

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <RecordPastShiftForm
        initialDate={initialDate}
        header={
          <View className="px-6 pb-4">
            <ScreenHeader eyebrow="Ore" goldEyebrow title={RECORD_TITLE} icon="close" />
          </View>
        }
      />
    </View>
  );
}
