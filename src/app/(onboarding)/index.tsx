import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Mono } from "@/components/ui/Mono";
import { GoldButton } from "@/components/ui/GoldButton";
import { AvatarPickerField } from "@/components/ui/AvatarPickerField";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useAvatarUpload } from "@/features/account/useAvatarUpload";
import { useCompleteOnboarding } from "@/features/onboarding/hooks";
import {
  onboardingSchema,
  type OnboardingForm,
} from "@/features/onboarding/schema";

/**
 * Setup del profilo professionista: **un passo solo**, e corto.
 *
 * Chiede solo come la sede ti vedrà: il nome (di solito già scritto alla
 * registrazione) e una foto facoltativa. Città e ruolo principale sono stati
 * tolti il 22/10/2026: la sede non li legge da nessuna parte. Prima ancora se
 * n'era andato il passo «competenze e attestati», roba da marketplace.
 *
 * Niente schermata «Tutto pronto» dopo il salvataggio: ripeteva il carosello che
 * parte subito dopo (`IntroOverlay`), e chiedeva due «Inizia» di fila.
 */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile, refreshProfile } = useAuth();
  const userId = session!.user.id;

  const complete = useCompleteOnboarding(userId);
  // Caricare la foto aggiorna il profilo ma non il flag: si resta qui.
  const photo = useAvatarUpload(userId);

  const { control, handleSubmit } = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { full_name: profile?.full_name ?? "" },
  });
  const name = useWatch({ control, name: "full_name" });

  const onContinue = handleSubmit(async (values) => {
    try {
      await complete.mutateAsync({ full_name: values.full_name.trim() });
      // Il profilo in memoria col flag alzato fa passare il gate a (waiter).
      await refreshProfile();
    } catch {
      toast.show("Impossibile salvare il profilo. Riprova.", "error");
    }
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 24 }}>
        <View className="shrink-0 px-6 pt-4 pb-6">
          <Mono gold>Il tuo profilo</Mono>
          <Display className="mt-2 text-[32px]">Come ti vedrà la tua sede</Display>
          <Text className="mt-2 font-sans text-[13.5px] leading-5 text-t3">
            Nome e foto compaiono sui turni e in chat. Puoi cambiarli quando vuoi
            dal profilo.
          </Text>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingBottom: 24,
            gap: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <AvatarPickerField
            uri={profile?.avatar_url}
            name={name || "Professionista"}
            busy={photo.busy}
            onPick={photo.pick}
            onRemove={photo.remove}
            addLabel="Aggiungi una foto (facoltativa)"
          />
          <ControlledInput
            control={control}
            name="full_name"
            label="Nome e cognome"
            placeholder="Es. Marco Rossi"
            autoCapitalize="words"
          />
        </ScrollView>

        <View className="px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
          <GoldButton
            size="lg"
            label={complete.isPending ? "Salvataggio…" : "Continua"}
            disabled={complete.isPending || photo.busy}
            onPress={onContinue}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
