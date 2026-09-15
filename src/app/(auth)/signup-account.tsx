import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Mono } from "@/components/ui/Mono";
import { Icon } from "@/components/ui/Icon";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import { signupSchema, type SignupForm } from "@/features/auth/schema";
import { PasswordChecklist } from "@/features/auth/PasswordChecklist";
import {
  resendLabel,
  useResendConfirmation,
} from "@/features/auth/useResendConfirmation";
import type { Enums } from "@/types/database";

type Role = Enums<"user_role">;

export default function SignupAccount() {
  const { signUp } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === "manager" ? "manager" : "waiter";
  const roleLabel = role === "manager" ? "Ristoratore" : "Professionista";

  const [apiError, setApiError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });
  const password = useWatch({ control, name: "password" }) ?? "";

  const onSubmit = handleSubmit(async (values) => {
    if (loading) return;
    setApiError(null);
    setEmailTaken(false);
    setLoading(true);
    const res = await signUp({
      email: values.email.trim(),
      password: values.password,
      fullName: values.fullName.trim(),
      role,
    });
    setLoading(false);
    if (res.error) {
      setApiError(res.error);
      return;
    }
    if (res.alreadyRegistered) {
      setEmailTaken(true);
      return;
    }
    if (res.needsConfirmation) {
      setSentTo(values.email.trim());
      return;
    }
    // in caso di sessione attiva, i guard nel root layout reindirizzano
  });

  if (sentTo) return <CheckYourMail email={sentTo} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="flex-grow px-6 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ height: insets.top + 8 }} />
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-1"
        >
          <Icon name="chevL" size={18} color="#C2BBB0" />
        </Pressable>

        <Mono gold className="mt-6">
          {roleLabel}
        </Mono>
        <Display className="mt-2 text-[28px]">Crea il tuo account</Display>
        <Text className="mt-2 font-sans text-[13.5px] text-t3">
          Bastano pochi dati per iniziare.
        </Text>

        <View className="mt-7 gap-4">
          <ControlledInput
            control={control}
            name="fullName"
            label="Nome e cognome"
            placeholder="Mario Rossi"
            autoCapitalize="words"
            autoComplete="name"
          />
          <ControlledInput
            control={control}
            name="email"
            label="Email"
            placeholder="nome@email.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
          />
          <ControlledInput
            control={control}
            name="password"
            label="Password"
            placeholder="Crea una password sicura"
            secureTextEntry
            autoCapitalize="none"
          />
          <PasswordChecklist value={password} />

          {apiError ? (
            <Text className="font-sans text-sm text-error">{apiError}</Text>
          ) : null}
          {emailTaken ? (
            <View className="gap-1.5">
              <Text className="font-sans text-sm text-error">
                Esiste già un account con questa email. Accedi o recupera la
                password.
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => router.push("/(auth)/login")}
              >
                <Text className="font-sans-semibold text-sm text-gold">
                  Vai all&apos;accesso
                </Text>
              </Pressable>
            </View>
          ) : null}

          <GoldButton
            className="mt-2"
            size="lg"
            label={loading ? "Creazione…" : "Crea account"}
            disabled={loading}
            onPress={onSubmit}
          />
        </View>

        <Pressable
          className="mt-8 flex-row justify-center gap-1"
          onPress={() => router.push("/(auth)/login")}
        >
          <Text className="font-sans text-sm text-t2">Hai già un account?</Text>
          <Text className="font-sans-semibold text-sm text-gold">Accedi</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * «Controlla la posta», con la via d'uscita per quando la posta non arriva.
 *
 * Componente a parte e non un ramo dentro la schermata: il rinvio ha bisogno di
 * un hook, e un hook dentro un `if (sentTo)` è un hook condizionale.
 *
 * Senza il rinvio, chi non riceve il messaggio — casella piena, spam, un filtro
 * aziendale — resta con un account che esiste e non può usare, e l'unica uscita
 * sarebbe registrarsi con un altro indirizzo: proprio quello da evitare, perché
 * è l'indirizzo a collegarlo alla scheda che il locale gli ha preparato.
 */
function CheckYourMail({ email }: { email: string }) {
  const router = useRouter();
  // `true`: l'email della registrazione è appena partita, quindi il contatore
  // parte da fermo. Offrire subito il bottone vorrebbe dire offrire un 429.
  const resend = useResendConfirmation(email, undefined, true);

  return (
    <ScrollView
      className="flex-1 bg-bg-0"
      contentContainerClassName="flex-grow justify-center px-6 pb-10"
    >
      <View className="items-center">
        <View className="overflow-hidden rounded-[22px] border border-border-2">
          <LinearGradient
            colors={["#362E24", "#1F1A13"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 72,
              height: 72,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="send" size={30} color="#EAB54C" />
          </LinearGradient>
        </View>
        <Display className="mt-6 text-[26px]">Controlla la posta</Display>
        <Text className="mt-3 text-center font-sans text-sm leading-6 text-t3">
          Ti abbiamo inviato un link di conferma a
        </Text>
        <Text className="text-center font-sans-semibold text-sm text-t1">
          {email}
        </Text>
        <Text className="mt-3 text-center font-sans text-[13px] leading-5 text-t3">
          Apri il link per attivare l&apos;account, poi accedi.
        </Text>
      </View>

      <View className="mt-8 gap-2 rounded-2xl border border-border-2 bg-bg-1 p-4">
        <Text className="text-center font-sans text-[13px] leading-5 text-t3">
          Non è arrivata? Controlla lo spam. Se non c&apos;è nemmeno lì,
          possiamo rimandarla.
        </Text>
        {resend.sent ? (
          <Text className="text-center font-sans text-[13px] text-success">
            Email rimandata.
          </Text>
        ) : null}
        {resend.error ? (
          <Text className="text-center font-sans text-[13px] text-error">
            {resend.error}
          </Text>
        ) : null}
        <GhostButton
          className="mt-1"
          label={resendLabel(resend)}
          disabled={resend.busy || resend.secondsLeft > 0}
          onPress={resend.resend}
        />
      </View>

      <GoldButton
        className="mt-6"
        size="lg"
        label="Vai all'accesso"
        onPress={() => router.replace("/(auth)/login")}
      />
    </ScrollView>
  );
}
