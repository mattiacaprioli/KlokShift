import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ConversationList } from "@/features/chat/ConversationList";
import { useAuth } from "@/lib/auth";
import { useColors } from "@/lib/theme";

export default function WaiterMessaggiScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session!.user.id;

  return (
    <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center justify-between px-5 pb-2">
        <View>
          <Mono gold>Chat</Mono>
          <Display className="mt-1 text-4xl leading-[46px]">Messaggi</Display>
        </View>
        {/* Scrivere a un collega, o a chi gestisce, senza passare da un turno. */}
        <Pressable
          onPress={() => router.push("/(waiter)/nuovo-messaggio")}
          hitSlop={8}
          accessibilityLabel="Nuovo messaggio"
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="plus" size={20} color={colors.t1} />
        </Pressable>
      </View>
      <ConversationList
        userId={userId}
        onOpen={(id) => router.push(`/(waiter)/chat/${id}`)}
        bottomInset={insets.bottom + 96}
      />
    </View>
  );
}
