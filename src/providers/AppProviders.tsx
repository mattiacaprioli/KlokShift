import type { PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "react-error-boundary";
import * as Sentry from "@sentry/react-native";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/lib/auth";
import { OwnerVenuesProvider } from "@/features/venues/OwnerVenues";
import { ToastProvider } from "@/providers/Toast";
import { ErrorFallback } from "@/providers/ErrorFallback";

/**
 * Composes the global providers. Order matters: Query + Auth must wrap the
 * navigator (screens read both); OwnerVenues sits inside Auth because it reads
 * `useAuth()`, and outside the navigator so `RealtimeSync` (mounted in
 * `app/_layout.tsx`, not inside the `(manager)` group) veda anche lui le sedi;
 * Toast wraps so any screen can fire toasts; ErrorBoundary is innermost so its
 * fallback can still use the providers above.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <OwnerVenuesProvider>
            <ToastProvider>
              <ErrorBoundary
                FallbackComponent={ErrorFallback}
                onError={(error) => Sentry.captureException(error)}
              >
                {children}
              </ErrorBoundary>
            </ToastProvider>
          </OwnerVenuesProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
