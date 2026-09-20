import "@/global.css";

import { Stack, SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import * as SystemUI from "expo-system-ui";
import { Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { useFonts } from "expo-font";
import { Fraunces_400Regular } from "@expo-google-fonts/fraunces/400Regular";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import { Fraunces_400Regular_Italic } from "@expo-google-fonts/fraunces/400Regular_Italic";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { useAuth } from "@/lib/auth";
import { AppProviders } from "@/providers/AppProviders";
import { NotificationsListener } from "@/features/notifications/NotificationsListener";
import { PushRegistrar } from "@/features/push/PushRegistrar";
import { RealtimeSync } from "@/features/realtime/RealtimeSync";
import { useViewMode } from "@/features/team/ViewMode";
import { IntroOverlay } from "@/features/onboarding/IntroOverlay";

SplashScreen.preventAutoHideAsync();
SystemUI.setBackgroundColorAsync("#0C0907");

// No-op until EXPO_PUBLIC_SENTRY_DSN is set (e.g. in a dev/production build).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false });
}

const BG = "#0C0907";

const screenOptions = {
  headerStyle: { backgroundColor: BG },
  headerTintColor: "#F8F4ED",
  contentStyle: { backgroundColor: BG },
} as const;

function ProfileError() {
  const { signOut } = useAuth();
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg-0 px-8">
      <Text className="text-center font-sans text-base text-t2">
        Non siamo riusciti a caricare il tuo profilo. Controlla la connessione e
        riprova.
      </Text>
      <GhostButton label="Esci" onPress={signOut} />
    </View>
  );
}

function RootNavigator() {
  const { session, profile, loading } = useAuth();
  // Il cappello con cui si usa l'app (gestione / lavoro): si ricava dalle
  // appartenenze, non da un ruolo sul profilo. Vedi `features/team/ViewMode.tsx`.
  const view = useViewMode();

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  // Don't let a font asset failure trap the app on the splash screen.
  const fontsReady = fontsLoaded || !!fontError;
  // `view.ready` entra nel gate dello splash solo quando c'è una sessione: senza
  // login non c'è nessuna vista da risolvere, e aspettarla terrebbe lo splash su
  // per una lettura da disco che riguarda un altro utente.
  const ready = !loading && fontsReady && (!session || view.ready);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Session restored but the profile couldn't be resolved (after retries):
  // render a recoverable screen instead of a blank Stack with no matching guard.
  if (session && !profile) return <ProfileError />;

  const isManagerView = !!session && view.effective === "manager";
  const isWaiterView = !!session && view.effective === "waiter";
  // Chi lavora senza aver completato il profilo professionale passa prima dal wizard.
  const waiterOnboarding = isWaiterView && !profile?.onboarding_complete;
  const waiterReady = isWaiterView && !!profile?.onboarding_complete;

  /**
   * Il cappello con cui girano realtime e push: la **vista**, non un ruolo. Chi ha
   * entrambe le viste deve ricevere gli aggiornamenti di quella che sta usando.
   */
  const activeRole = view.effective;

  return (
    <View style={{ flex: 1 }}>
      {session && profile ? (
        <>
          <NotificationsListener userId={session.user.id} />
          <RealtimeSync userId={session.user.id} role={activeRole} />
          <PushRegistrar role={activeRole} />
        </>
      ) : null}
      <Stack screenOptions={screenOptions}>
        <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={isManagerView}>
        <Stack.Screen name="(manager)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={waiterOnboarding}>
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={waiterReady}>
        <Stack.Screen name="(waiter)" options={{ headerShown: false }} />
      </Stack.Protected>

      {__DEV__ ? (
        <Stack.Screen name="(dev)/components" options={{ title: "Design System" }} />
      ) : null}
      </Stack>
      {session && profile ? <IntroOverlay /> : null}
    </View>
  );
}

function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="light" />
      <RootNavigator />
    </AppProviders>
  );
}

export default Sentry.wrap(RootLayout);
