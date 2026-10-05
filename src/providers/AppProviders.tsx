import { useEffect, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "react-error-boundary";
import * as Sentry from "@sentry/react-native";
import { queryClient } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { AuthProvider } from "@/lib/auth";
import { OwnerVenuesProvider } from "@/features/venues/OwnerVenues";
import { ViewModeProvider } from "@/features/team/ViewMode";
import { ToastProvider } from "@/providers/Toast";
import { ErrorFallback } from "@/providers/ErrorFallback";

/**
 * Composes the global providers. Order matters: Query + Auth must wrap the
 * navigator (screens read both); OwnerVenues sits inside Auth because it reads
 * `useAuth()`, and outside the navigator so `RealtimeSync` (mounted in
 * `app/_layout.tsx`, not inside the `(manager)` group) veda anche lui le sedi;
 * ViewMode sta dentro OwnerVenues perché la doppia vista di un professionista
 * promosso dipende dai suoi accessi delegati (F3), e fuori dal navigatore
 * perché è lui a decidere quale gruppo di rotte è montato;
 * Toast wraps so any screen can fire toasts; ErrorBoundary is innermost so its
 * fallback can still use the providers above.
 */
export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void queryClient.invalidateQueries({ queryKey: qk.workspaceAccess.all });
    });
    return () => listener.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <OwnerVenuesProvider>
            <ViewModeProvider>
              <ToastProvider>
                <ErrorBoundary
                  FallbackComponent={ErrorFallback}
                  onError={(error) => Sentry.captureException(error)}
                >
                  {children}
                </ErrorBoundary>
              </ToastProvider>
            </ViewModeProvider>
          </OwnerVenuesProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
