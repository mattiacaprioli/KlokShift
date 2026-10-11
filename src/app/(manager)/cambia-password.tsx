import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, View } from "@/tw";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { useToast } from "@/providers/Toast";

export default function ManagerChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-2">
          <ScreenHeader eyebrow="Impostazioni" title="Password" />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <ChangePasswordForm
            onDone={() => {
              toast.show("Password aggiornata.");
              router.back();
            }}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
