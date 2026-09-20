import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ContactPicker } from "@/features/chat/ContactPicker";
import { useAuth } from "@/lib/auth";

/** A chi scrivere: le persone dell'azienda, organico e gestione. */
export default function ManagerNewMessageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-5 pb-3">
        <ScreenHeader eyebrow="Chat" title="Nuovo messaggio" icon="close" />
      </View>
      <ContactPicker
        userId={session!.user.id}
        // `replace`: chiudendo il thread si torna ai Messaggi, non alla rubrica.
        onOpened={(id) => router.replace(`/(manager)/chat/${id}`)}
        bottomInset={insets.bottom + 24}
      />
    </View>
  );
}
