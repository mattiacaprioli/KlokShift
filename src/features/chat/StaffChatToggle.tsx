import { Switch } from "react-native";
import { Text, View } from "@/tw";
import { Card } from "@/components/ui/Card";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import {
  useSetStaffCanChat,
  useStaffCanChat,
} from "@/features/workspace/hooks";

/**
 * «Chat fra colleghi», nelle impostazioni dell'azienda.
 *
 * Acceso di default, come il planning visibile all'organico: chi lavora insieme
 * si parla comunque, e pretendere un'azione del titolare avrebbe reso la
 * funzione invisibile quasi ovunque. L'interruttore c'è per chi non vuole
 * messaggi fra dipendenti dentro l'app dell'azienda.
 *
 * Spegnerlo non cancella niente: i thread aperti restano leggibili, non se ne
 * aprono di nuovi. E non isola mai nessuno da chi gestisce — al titolare e ai
 * collaboratori si scrive sempre.
 */
export function StaffChatToggle({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const { data: enabled, isLoading } = useStaffCanChat(workspaceId);
  const save = useSetStaffCanChat();

  function toggle(value: boolean) {
    save.mutate(
      { workspaceId, enabled: value },
      {
        onSuccess: () =>
          toast.show(
            value
              ? "I colleghi possono scriversi"
              : "Chat fra colleghi disattivata"
          ),
        onError: (e) =>
          toast.show(
            userErrorMessage(e, "Impossibile salvare. Riprova."),
            "error"
          ),
      }
    );
  }

  return (
    <Card className="flex-row items-center justify-between gap-3 px-4 py-3.5">
      <View className="flex-1">
        <Text className="text-[15px] font-sans-semibold text-t1">
          Chat fra colleghi
        </Text>
        <Text className="mt-0.5 text-[13px] text-t3">
          Chi è in organico può scriversi. A te e ai collaboratori si scrive
          comunque.
        </Text>
      </View>
      <Switch
        value={enabled ?? true}
        onValueChange={toggle}
        disabled={isLoading || save.isPending}
        trackColor={{ false: "#2a241b", true: "#eab54c" }}
        thumbColor="#f8f4ed"
        ios_backgroundColor="#2a241b"
      />
    </Card>
  );
}
