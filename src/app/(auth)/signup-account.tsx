import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppState, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Display } from "@/components/ui/Display";
import { Icon } from "@/components/ui/Icon";
import { GoldButton } from "@/components/ui/GoldButton";
import { GhostButton } from "@/components/ui/GhostButton";
import { ControlledInput } from "@/components/form/ControlledInput";
import { useAuth } from "@/lib/auth";
import {
  isPasswordValid,
  signupSchema,
  type SignupForm,
} from "@/features/auth/schema";
import { PasswordChecklist } from "@/features/auth/PasswordChecklist";
import {
  resendLabel,
  useResendConfirmation,
} from "@/features/auth/useResendConfirmation";
import { CONFIRM_REDIRECT_URL } from "@/features/auth/redirects";
import type { ViewMode } from "@/features/team/viewModeStorage";
import { useColors } from "@/lib/theme";

type Intent = ViewMode;

export default function SignupAccount() {
  const { signUp } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "manager" ? "manager" : "waiter";
  const intentLabel = intent === "manager" ? "Gestione sede" : "Dipendente";

  const [apiError, setApiError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  // Email e password restano in memoria solo su questa schermata, come già nel
  // form: servono a «Controlla la posta» per far entrare da sola la persona
  // quando torna dall'email confermata.
  const [sentTo, setSentTo] = useState<{ email: string; password: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm<SignupForm>({
    // `onTouched` e non il submit: con la validazione al solo invio, togliere un
    // carattere a una password già tutta verde non dava alcun segnale fino alla
    // pressione del bottone — e la checklist qui sotto invita a guardare i
    // requisiti, non il campo.
    mode: "onTouched",
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
  const password = useWatch({ control, name: "password" }) ?? "";
  const confirmPassword = useWatch({ control, name: "confirmPassword" }) ?? "";
  // Il bottone non si accende finché la password non è davvero buona: la
  // checklist dice già cosa manca, quindi non è un blocco muto.
  const passwordReady = isPasswordValid(password) && password === confirmPassword;

  const onSubmit = handleSubmit(async (values) => {
    if (loading) return;
    setApiError(null);
    setEmailTaken(false);
    setLoading(true);
    const res = await signUp({
      email: values.email.trim(),
      password: values.password,
      fullName: values.fullName.trim(),
      intent,
      emailRedirectTo: CONFIRM_REDIRECT_URL,
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
      setSentTo({ email: values.email.trim(), password: values.password });
      return;
    }
    // in caso di sessione attiva, i guard nel root layout reindirizzano
  });

  if (sentTo) return <CheckYourMail email={sentTo.email} password={sentTo.password} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <View
        className="flex-1 bg-bg-0"
        style={{ paddingBottom: insets.bottom }}
      >
        <View className="shrink-0 px-6 pb-3" style={{ paddingTop: insets.top + 8 }}>
          <ScreenHeader eyebrow={intentLabel} title="Crea il tuo account" titleClassName="text-[28px]" />
          <Text className="mt-3 font-sans text-[13.5px] text-t3">
            Bastano pochi dati per iniziare.
          </Text>
        </View>

        {/* Il modulo al centro dello spazio sotto il titolo, come nella scelta
            del ruolo; con la tastiera aperta si scorre. ⚠️ Solo classi sul
            contentContainer: un `contentContainerStyle` le sostituirebbe. */}
        <ScrollView
          className="flex-1 bg-bg-0"
          contentContainerClassName="flex-grow justify-center px-6 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-4">
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
              autoComplete="new-password"
            />
            <ControlledInput
              control={control}
              name="confirmPassword"
              label="Ripeti la password"
              placeholder="La stessa password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
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
              disabled={loading || !passwordReady}
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
      </View>
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
 * è l'indirizzo a collegarlo alla scheda che la sede gli ha preparato.
 */
function CheckYourMail({ email, password }: { email: string; password: string }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `true`: l'email della registrazione è appena partita, quindi il contatore
  // parte da fermo. Offrire subito il bottone vorrebbe dire offrire un 429.
  const resend = useResendConfirmation(email, CONFIRM_REDIRECT_URL, true);
  const { tryEnter, entering, enterError } = useEnterWhenConfirmed(email, password);

  return (
    <View className="flex-1 bg-bg-0">
      <View className="shrink-0 items-center px-6 pb-6" style={{ paddingTop: insets.top + 24 }}>
        <View className="overflow-hidden rounded-[22px] border border-border-2">
          <LinearGradient
            colors={[colors.bg3, colors.bg1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 72,
              height: 72,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="send" size={30} color={colors.gold} />
          </LinearGradient>
        </View>
        <Display className="mt-6 text-[26px]">Controlla la posta</Display>
      </View>
      <ScrollView
        className="flex-1 bg-bg-0"
        contentContainerClassName="flex-grow px-6 pb-10"
      >
        <View className="items-center">
          <Text className="text-center font-sans text-sm leading-6 text-t3">
            Ti abbiamo inviato un link di conferma a
          </Text>
          <Text className="text-center font-sans-semibold text-sm text-t1">
            {email}
          </Text>
          <Text className="mt-3 text-center font-sans text-[13px] leading-5 text-t3">
            Apri il link per attivare l&apos;account, poi torna qui: entri da
            solo.
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

        {enterError ? (
          <Text className="mt-6 text-center font-sans text-[13px] leading-5 text-error">
            {enterError}
          </Text>
        ) : null}
        <GoldButton
          className="mt-6"
          size="lg"
          label={entering ? "Accesso…" : "Ho confermato, entra"}
          disabled={entering}
          onPress={() => tryEnter(true)}
        />
        <Pressable
          className="mt-5 items-center"
          onPress={() => router.replace("/(auth)/login")}
        >
          <Text className="font-sans-semibold text-sm text-gold">Vai all&apos;accesso</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/**
 * Entra appena l'email risulta confermata, senza far riscrivere email e
 * password: prova l'accesso quando l'app torna in primo piano (la persona
 * rientra dalla posta o dalla pagina «Email confermata») e quando preme il
 * pulsante. Con la sessione aperta ci pensano i guard del root layout.
 *
 * In automatico tace: un «email non confermata» vuol dire solo che non ha
 * ancora aperto il link. Dal pulsante dice cosa manca.
 */
function useEnterWhenConfirmed(email: string, password: string) {
  const { signIn } = useAuth();
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const busy = useRef(false);

  const tryEnter = useCallback(
    async (fromButton: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (fromButton) {
        setEntering(true);
        setEnterError(null);
      }
      const res = await signIn(email, password);
      busy.current = false;
      setEntering(false);
      if (!res.error || !fromButton) return;
      setEnterError(
        res.needsConfirmation
          ? "L'email non risulta ancora confermata. Apri il link che ti abbiamo mandato, poi riprova."
          : res.error
      );
    },
    [signIn, email, password]
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void tryEnter(false);
    });
    return () => sub.remove();
  }, [tryEnter]);

  return { tryEnter, entering, enterError };
}
