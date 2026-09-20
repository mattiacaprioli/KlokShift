import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Mono } from "@/components/ui/Mono";
import { Icon } from "@/components/ui/Icon";
import { GoldButton } from "@/components/ui/GoldButton";
import { ControlledInput } from "@/components/form/ControlledInput";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { useCompleteOnboarding } from "@/features/onboarding/hooks";
import { PRIMARY_ROLE_EXAMPLES } from "@/features/onboarding/api";
import {
  onboardingSchema,
  type OnboardingForm,
} from "@/features/onboarding/schema";

/**
 * Setup del profilo professionista: **un passo solo**.
 *
 * Ce n'erano due: il secondo chiedeva competenze auto-dichiarate e attestati. Era
 * roba da marketplace — servivano a farsi scegliere da una sede sconosciuta — e
 * nessuna delle due veniva mai riletta: `waiter_profiles.skills` non compariva in
 * una sola schermata, e gli attestati finivano in un bucket che solo chi li
 * caricava poteva leggere. Chi viene invitato da una sede deve arrivare ai suoi
 * turni, non compilare una vetrina che nessuno guarda. I documenti, che nel
 * gestionale contano davvero, vivono ora sulla scheda staff con le scadenze.
 */

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile, refreshProfile } = useAuth();
  const userId = session!.user.id;

  const [done, setDone] = useState(false);

  const complete = useCompleteOnboarding(userId);

  const { control, handleSubmit } = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      full_name: profile?.full_name ?? "",
      city: "",
      primary_role: "",
    },
  });

  const firstName = (profile?.full_name ?? "").trim().split(" ")[0];
  const doneTitle = firstName ? `Tutto pronto, ${firstName}.` : "Tutto pronto!";

  const onCreate = handleSubmit(async (values) => {
    try {
      await complete.mutateAsync({
        full_name: values.full_name.trim(),
        city: values.city.trim() || null,
        primary_role: values.primary_role,
      });
      // NON chiamiamo refreshProfile qui: il gate scatterebbe subito e la
      // schermata di successo non verrebbe mostrata. Rimane in (onboarding).
      setDone(true);
    } catch {
      toast.show("Impossibile creare il profilo. Riprova.", "error");
    }
  });

  const onEnter = async () => {
    // Solo ora aggiorniamo il profilo in memoria → il guard passa a (waiter).
    await refreshProfile();
  };

  // Schermata di successo — takeover a tutto schermo.
  if (done) {
    return (
      <View
        className="flex-1 bg-bg-0 px-6"
        style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <View className="flex-1 items-center justify-center">
          <View
            className="h-24 w-24 items-center justify-center rounded-full bg-gold"
            style={{
              shadowColor: "#EAB54C",
              shadowOpacity: 0.5,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <Icon name="check" size={44} color="#1A1206" />
          </View>
          <Mono gold className="mt-6">
            Profilo creato
          </Mono>
          <Display className="mt-2 text-center text-[30px]">{doneTitle}</Display>
          <Text className="mt-2 text-center font-sans text-[13.5px] leading-5 text-t3">
            Le sedi per cui lavori ti assegneranno i turni: li trovi tutti qui.
          </Text>

          {/* QR e recensioni **non** compaiono qui di proposito: è la prima cosa
              che si vede dopo la registrazione, e chi arriva su invito di un
              sede deve capire che il prodotto sono i suoi turni. La
              reputazione la scopre dal profilo, quando ha qualcosa da mostrare.

              Niente chevron: queste righe non sono tappabili, e non possono
              esserlo — finché non si tocca «Inizia» il profilo in memoria non è
              aggiornato e il guard tiene ancora l'utente in (onboarding). */}
          <View className="mt-8 w-full overflow-hidden rounded-3xl border border-border-2 bg-bg-card">
            {[
              {
                icon: "calendar" as const,
                label: "Conferma i turni che ti assegnano",
              },
              { icon: "clock" as const, label: "Tieni il conto delle tue ore" },
            ].map((row, i) => (
              <View
                key={row.label}
                className={cn(
                  "flex-row items-center gap-3 p-4",
                  i > 0 && "border-t border-border"
                )}
              >
                <Icon name={row.icon} size={18} color="#EAB54C" />
                <Text className="flex-1 font-sans text-[14px] text-t1">
                  {row.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <GoldButton size="lg" label="Inizia" onPress={onEnter} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <View className="flex-1 bg-bg-0" style={{ paddingTop: insets.top + 24 }}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 24,
            gap: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View>
            <Mono gold>Il tuo profilo</Mono>
            <Display className="mt-2 text-[32px]">Chi sei?</Display>
            <Text className="mt-2 font-sans text-[13.5px] leading-5 text-t3">
              Le vede chi ti mette in turno, per sapere chi sta chiamando.
            </Text>
          </View>
          <ControlledInput
            control={control}
            name="full_name"
            label="Nome e cognome"
            placeholder="Es. Marco Rossi"
            autoCapitalize="words"
          />
          <ControlledInput
            control={control}
            name="city"
            label="Città"
            placeholder="Milano"
          />
          <ControlledInput
            control={control}
            name="primary_role"
            label="Ruolo principale"
            placeholder={PRIMARY_ROLE_EXAMPLES}
          />
        </ScrollView>

        {/* Footer con CTA */}
        <View
          className="px-6 pt-2"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <GoldButton
            size="lg"
            label={complete.isPending ? "Creazione…" : "Crea il mio profilo"}
            disabled={complete.isPending}
            onPress={onCreate}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
