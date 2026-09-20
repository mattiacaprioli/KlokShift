import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { AvatarPickerField } from "@/components/ui/AvatarPickerField";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ControlledInput } from "@/components/form/ControlledInput";
import { updateMyProfile } from "@/features/account/api";
import { accountSchema, type AccountForm } from "@/features/account/schema";
import { useAvatarUpload } from "@/features/account/useAvatarUpload";
import { useAuth } from "@/lib/auth";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";

/**
 * Il proprio account, lato gestore: nome e foto della **persona**, non del
 * sede.
 *
 * Sono due identità diverse e finivano per essere confuse: il Profilo del
 * gestore parla della sede (logo, città, scheda), mentre nome e foto personali
 * sono quelli che il professionista vede in chat e sotto i turni assegnati.
 * Fino al 14/09/2026 si potevano cambiare solo dalla dashboard web — chi usa
 * solo il telefono restava con il nome scritto in fase di registrazione.
 *
 * Gli stessi due campi della dashboard (`web/src/pages/Impostazioni.tsx`): il
 * resto è roba del professionista: la città in `profiles`, ruolo e lingue in
 * `waiter_profiles`.
 */
export default function ManagerAccountEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile, refreshProfile } = useAuth();
  const userId = session!.user.id;
  const photo = useAvatarUpload(userId);

  const { control, handleSubmit, reset, formState } = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { full_name: "" },
  });

  useEffect(() => {
    reset({ full_name: profile?.full_name ?? "" });
  }, [profile?.full_name, reset]);

  // ⚠️ `defaultValue`: `useWatch` si iscrive in un effect, quindi quando il
  // profilo è già in memoria il `reset()` qui sopra parte **prima** e la sua
  // notifica va persa — il nome resterebbe vuoto (avatar con l'iniziale del
  // fallback) finché non si tocca il campo.
  const watchedName = useWatch({
    control,
    name: "full_name",
    defaultValue: profile?.full_name ?? "",
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateMyProfile(userId, { full_name: values.full_name });
      await refreshProfile();
      toast.show("Profilo salvato");
      router.back();
    } catch (e) {
      toast.show(userErrorMessage(e, "Salvataggio non riuscito"), "error");
    }
  });

  return (
    // ⚠️ `behavior="padding"` sempre: con l'edge-to-edge di SDK 54+
    // `adjustResize` non sposta più niente da solo.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-3">
          <ScreenHeader
            icon="close"
            eyebrow="Account"
            title="Il tuo profilo"
            titleClassName="text-2xl"
            right={
              <GoldButton
                size="sm"
                label="Salva"
                onPress={onSubmit}
                disabled={formState.isSubmitting}
              />
            }
          />
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingTop: 8,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 24,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <AvatarPickerField
            uri={photo.uri}
            name={watchedName || "Gestore"}
            busy={photo.busy}
            onPick={photo.pick}
            onRemove={photo.remove}
          />

          <View className="gap-4 rounded-3xl border border-border-2 bg-bg-card p-5">
            <ControlledInput
              control={control}
              name="full_name"
              label="Nome e cognome"
              placeholder="Giuseppe Buffa"
            />
            {/* L'email non si cambia da qui: è la credenziale con cui si entra,
                e cambiarla vuol dire riverificarla. */}
            <View className="gap-0.5">
              <Mono>Email</Mono>
              <Text className="text-sm text-t2">{session?.user.email}</Text>
            </View>
          </View>

          <View className="flex-row gap-3 rounded-3xl border border-border-2 bg-bg-card p-5">
            <Icon name="shield" size={20} color="#4FC97D" />
            <Text className="flex-1 text-sm leading-5 text-t3">
              Nome e foto sono i tuoi, non della sede: è così che ti vede chi
              lavora con te, in chat e sui turni. La sede si modifica dal
              Profilo.
            </Text>
          </View>

          <GoldButton
            label={formState.isSubmitting ? "Salvataggio…" : "Salva modifiche"}
            disabled={formState.isSubmitting}
            onPress={onSubmit}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
