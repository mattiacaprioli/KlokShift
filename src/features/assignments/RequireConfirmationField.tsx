import { Switch } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { Mono } from "@/components/ui/Mono";

/**
 * «Chiedi la conferma a tutti», nel form del turno.
 *
 * Spento di default: di norma la conferma la chiede solo chi è a chiamata, e per
 * il dipendente fisso l'assegnazione nasce già confermata (il turno è il suo
 * lavoro, non un invito — vedi la migration 20260915100000). Lo switch serve ai
 * turni in cui anche al fisso si vuole un sì esplicito: straordinario, festivo,
 * una serata fuori dall'ordinario.
 *
 * ⚠️ Non è la stessa cosa di una modifica di data/orario: quella riapre la
 * conferma a tutti da sé, senza che nessuno debba accendere niente.
 */
export function RequireConfirmationField({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <Mono>Conferma</Mono>
      <Card className="flex-row items-center justify-between gap-3 px-4 py-3.5">
        <View className="flex-1">
          <Text className="text-[15px] font-sans-semibold text-t1">
            Chiedi conferma a tutti
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3">
            Di norma confermano solo i collaboratori a chiamata: chi è assunto
            fisso risulta già in turno.
          </Text>
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: "#2a241b", true: "#eab54c" }}
          thumbColor="#f8f4ed"
          ios_backgroundColor="#2a241b"
        />
      </Card>
    </View>
  );
}
