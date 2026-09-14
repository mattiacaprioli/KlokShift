import { useRouter } from "expo-router";
import { View } from "@/tw";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoldButton } from "@/components/ui/GoldButton";
import { cn } from "@/lib/cn";

/**
 * Il titolare non ha (ancora) nessuna sede.
 *
 * Fino al 14/09/2026 questo era un **gate**: una porta davanti a tutto, perché
 * senza una sede attiva nessuna schermata sapeva cosa guardare. Ora non c'è più
 * una sede da scegliere, quindi non c'è più una porta: è uno stato vuoto, e ogni
 * schermata che ha davvero bisogno di una sede lo mostra al posto del proprio
 * contenuto.
 *
 * ⚠️ La home **non** lo usa: saluta, mostra i KPI a zero e invita a creare il
 * primo locale. Chi apre l'app la prima volta non deve trovare un muro.
 */
export function NoVenuesState({
  subtitle = "Ti serve un locale prima di organizzare i turni.",
  className,
}: {
  subtitle?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <View className={cn("mt-6", className)}>
      <EmptyState title="Configura il tuo locale" subtitle={subtitle} />
      <GoldButton
        className="mt-2"
        label="Configura locale"
        onPress={() => router.push("/(manager)/venue/new")}
      />
    </View>
  );
}
