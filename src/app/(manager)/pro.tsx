import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/providers/Toast";

// Cosa sblocca il Pro (la gestione completa del personale, già costruita).
// Nessun prezzo qui: il modello di monetizzazione è ancora da definire → questa
// schermata è un preview del futuro upsell, non un checkout.
const FEATURES: { icon: IconName; title: string; sub: string }[] = [
  {
    icon: "clock",
    title: "Ore & presenze",
    sub: "Riepilogo mensile delle ore e export pronto per il commercialista.",
  },
  {
    icon: "shield",
    title: "Performance dello staff",
    sub: "Turni svolti, ore totali e affidabilità di ogni membro.",
  },
];

export default function ManagerProScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  return (
    <View className="flex-1 bg-bg-0">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
      >
        <ScreenHeader eyebrow="KlokShift" title="Pro" goldEyebrow icon="close" />

        <View className="items-center gap-3 py-2">
          <View className="h-16 w-16 items-center justify-center rounded-full border border-border-gold bg-bg-2">
            <Icon name="sparkle" size={30} color="#EAB54C" />
          </View>
          <Text className="text-center text-xl font-sans-bold text-t1">
            La gestione completa del tuo personale
          </Text>
          <Text className="max-w-[300px] text-center text-sm leading-5 text-t2">
            Organizza i turni con il tuo staff, tieni sotto controllo le ore e
            valuta le performance. La copertura dei turni resta sempre gratuita.
          </Text>
        </View>

        <View className="overflow-hidden rounded-3xl border border-border-2 bg-bg-card">
          {FEATURES.map((f, i) => (
            <View
              key={f.title}
              className={
                "flex-row items-start gap-3 p-4" +
                (i > 0 ? " border-t border-border" : "")
              }
            >
              <View className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2">
                <Icon name={f.icon} size={18} color="#EAB54C" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-sans-bold text-t1">
                  {f.title}
                </Text>
                <Text className="mt-0.5 text-xs leading-4 text-t3">{f.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        <View className="gap-2 rounded-3xl border border-border-2 bg-bg-1 p-4">
          <Text className="text-center text-sm font-sans-semibold text-t1">
            Stiamo definendo i piani
          </Text>
          <Text className="text-center text-xs leading-4 text-t3">
            Presto potrai attivare KlokShift Pro. Facci sapere se ti interessa:
            terremo conto del tuo riscontro.
          </Text>
        </View>

        <GoldButton
          label="Sono interessato"
          onPress={() =>
            toast.show("Grazie! Ti terremo aggiornato su KlokShift Pro.")
          }
        />
      </ScrollView>
    </View>
  );
}
