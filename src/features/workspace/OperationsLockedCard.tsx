import { useRouter } from "expo-router";
import { Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { operationsGate } from "./access";

/**
 * Al posto di un pulsante nascosto: perché qui non si può ancora aggiungere o
 * creare, e — per il titolare in `setup` — il tocco che lo sblocca.
 * Non rende niente se l'azienda è operativa.
 */
export function OperationsLockedCard({ title }: { title: string }) {
  const router = useRouter();
  const { access, accessPending, isOwner } = useOwnerVenues();
  if (accessPending) return null;
  const gate = operationsGate(access, { isOwner });
  if (gate.allowed) return null;
  return (
    <View className="gap-3 rounded-3xl border border-border-gold bg-bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-2">
          <Icon name="lock" size={18} color="#EAB54C" />
        </View>
        <Text className="flex-1 text-base font-sans-bold text-t1">{title}</Text>
      </View>
      <Text className="text-sm leading-5 text-t2">{gate.reason}</Text>
      {gate.canStartTrial ? (
        <GoldButton
          size="sm"
          label="Avvia la prova"
          onPress={() => router.push("/(manager)/prova")}
        />
      ) : null}
    </View>
  );
}
