import { Linking } from "react-native";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Pressable, Text, View } from "@/tw";
import { LEGAL_URLS } from "./legal";

type Row = { label: string; hint: string; url: string };

const ROWS: Row[] = [
  {
    label: "Informativa sulla privacy",
    hint: "Quali dati raccogliamo e perché",
    url: LEGAL_URLS.privacy,
  },
  {
    label: "Accordo sul trattamento dei dati",
    hint: "Come trattiamo i dati del team per l'azienda",
    url: LEGAL_URLS.dpa,
  },
  {
    label: "Sicurezza dei dati",
    hint: "Come proteggiamo i dati, e cosa non c'è ancora",
    url: LEGAL_URLS.security,
  },
  {
    label: "Eliminazione dell'account",
    hint: "Cosa viene eliminato e cosa resta",
    url: LEGAL_URLS.accountDeletion,
  },
];

/**
 * Collegamenti alle pagine legali, condivisi dalle impostazioni dei due ruoli.
 * Entrambi gli store si aspettano che l'informativa sia raggiungibile
 * dall'utente, non solo dichiarata nella scheda dello store.
 */
export function LegalLinks() {
  return (
    <View className="gap-2">
      <SectionHeader title="Legale" />
      <Card className="p-0">
        {ROWS.map((row, i) => (
          <Pressable
            key={row.url}
            onPress={() => Linking.openURL(row.url)}
            className={cnRow(i)}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-2">
              <Icon name="shield" size={18} color="#EAB54C" />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-sans-semibold text-t1">
                {row.label}
              </Text>
              <Text className="mt-0.5 text-[13px] text-t3">{row.hint}</Text>
            </View>
            <Icon name="chevR" size={18} color="#6A6358" />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

function cnRow(index: number) {
  return index === 0
    ? "flex-row items-center gap-3 px-4 py-3.5"
    : "flex-row items-center gap-3 border-t border-border px-4 py-3.5";
}
