import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Segmented } from "@/components/ui/Segmented";
import { useThemePreference } from "@/providers/Theme";
import { Text, View } from "@/tw";
import { THEME_OPTIONS, themeHint } from "./themePreference";

/**
 * «Aspetto» in Impostazioni, uguale per chi lavora e per chi gestisce:
 * Automatico (segue il telefono), Chiaro o Scuro. Vale per questo telefono; la
 * dashboard web ha la sua scelta.
 */
export function ThemeSection() {
  const { preference, scheme, setPreference } = useThemePreference();
  return (
    <View className="gap-2">
      <SectionHeader title="Aspetto" />
      <Card className="gap-3">
        <View>
          <Text className="text-[15px] font-sans-semibold text-t1">Tema</Text>
          <Text className="mt-0.5 text-[13px] text-t3">{themeHint(preference, scheme)}</Text>
        </View>
        <Segmented options={THEME_OPTIONS} value={preference} onChange={setPreference} />
      </Card>
    </View>
  );
}
