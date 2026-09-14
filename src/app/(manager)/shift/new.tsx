import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { StaffShiftForm } from "@/features/assignments/StaffShiftForm";

/** "YYYY-MM-DD" dal calendario dell'agenda, se si arriva da lì. */
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export default function NewShiftScreen() {
  const insets = useSafeAreaInsets();
  const { date } = useLocalSearchParams<{ date?: string }>();
  // Chi tocca «+» avendo un giorno selezionato sta creando un turno *per quel
  // giorno*: farglielo riscegliere nel form era un passo di troppo.
  const initialDate =
    date && DATE_PARAM.test(date) ? new Date(`${date}T00:00:00`) : undefined;

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-6 pb-4">
        <ScreenHeader
          eyebrow="Il tuo staff"
          goldEyebrow
          title="Nuovo turno"
          icon="close"
        />
      </View>

      {/* La sede la sceglie il form: è un campo del turno, non del contesto. */}
      <StaffShiftForm initialDate={initialDate} />
    </View>
  );
}
