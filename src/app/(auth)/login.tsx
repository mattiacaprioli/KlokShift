import { useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { LogoBadge } from "@/components/ui/LogoBadge";
import { Display } from "@/components/ui/Display";
import { GoldButton } from "@/components/ui/GoldButton";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { loginSchema, type LoginForm } from "@/features/auth/schema";
import {
  resendLabel,
  useResendConfirmation,
} from "@/features/auth/useResendConfirmation";
import { GhostButton } from "@/components/ui/GhostButton";

export default function Login() {
  const { signIn, resetPassword } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** L'ultimo tentativo è fallito perché l'email non è confermata. */
  const [unconfirmed, setUnconfirmed] = useState(false);

  const { control, handleSubmit, getValues } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (loading) return;
    setApiError(null);
    setLoading(true);
    const res = await signIn(values.email.trim(), values.password);
    setLoading(false);
    if (res.error) setApiError(res.error);
    // L'account esiste, l'email non è mai stata confermata. Il messaggio da
    // solo lascia in un vicolo cieco chi quella mail non l'ha mai ricevuta: si
    // apre il rinvio, sull'indirizzo che ha appena scritto.
    setUnconfirmed(res.needsConfirmation);
    // in caso di successo la navigazione è gestita dai guard nel root layout
  });

  async function onForgot() {
    const email = getValues("email").trim();
    if (!email.includes("@")) {
      toast.show("Inserisci la tua email per recuperare la password.", "error");
      return;
    }
    const { error } = await resetPassword(email);
    if (error) toast.show(error, "error");
    else toast.show("Email di recupero inviata. Controlla la posta.");
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="flex-grow justify-center p-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center">
          <LogoBadge size={72} />
          <Display className="mt-5 text-[26px]">Bentornato</Display>
          <Text className="mt-1.5 font-sans text-sm text-t3">
            Accedi al tuo account
          </Text>
        </View>

        <View className="mt-9 gap-4">
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
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
          />

          <Pressable className="self-end" onPress={onForgot}>
            <Text className="font-sans text-xs text-gold">
              Password dimenticata?
            </Text>
          </Pressable>

          {apiError ? (
            <Text className="font-sans text-sm text-error">{apiError}</Text>
          ) : null}

          {unconfirmed ? <ResendBlock control={control} /> : null}

          <GoldButton
            className="mt-2"
            size="lg"
            label={loading ? "Accesso…" : "Accedi"}
            disabled={loading}
            onPress={onSubmit}
          />
        </View>

        <Pressable
          className="mt-8 flex-row justify-center gap-1"
          onPress={() => router.push("/(auth)/signup")}
        >
          <Text className="font-sans text-sm text-t2">Non hai un account?</Text>
          <Text className="font-sans-semibold text-sm text-gold">Registrati</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Il rinvio della conferma, sull'indirizzo scritto nel form.
 *
 * `useWatch` e non `getValues`: il contatore e l'etichetta del bottone devono
 * rifare il render, e `getValues` non li farebbe muovere. Componente a parte
 * perché l'hook non può stare dentro il ramo condizionale che lo mostra.
 */
function ResendBlock({ control }: { control: Control<LoginForm> }) {
  const email = useWatch({ control, name: "email" }) ?? "";
  const resend = useResendConfirmation(email);

  return (
    <View className="gap-2 rounded-2xl border border-border-2 bg-bg-1 p-4">
      <Text className="font-sans text-[13px] leading-5 text-t3">
        Non hai ricevuto il link di conferma? Controlla lo spam, poi possiamo
        rimandarlo a {email.trim()}.
      </Text>
      {resend.sent ? (
        <Text className="font-sans text-[13px] text-success">
          Email rimandata.
        </Text>
      ) : null}
      {resend.error ? (
        <Text className="font-sans text-[13px] text-error">{resend.error}</Text>
      ) : null}
      <GhostButton
        className="mt-1"
        size="sm"
        label={resendLabel(resend)}
        disabled={resend.busy || resend.secondsLeft > 0}
        onPress={resend.resend}
      />
    </View>
  );
}
