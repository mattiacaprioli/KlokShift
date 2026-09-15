import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
// queryClient e AuthProvider arrivano dal codice dell'app: stessa semantica di
// sessione e di cache, nessuna divergenza fra mobile e dashboard.
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/lib/auth";
import { App } from "./App";
import { ToastProvider } from "./ui/Toast";
import { AppErrorBoundary } from "./ui/ErrorBoundary";
import { consumeAuthLink } from "./lib/recovery";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// Prima del mount: chi arriva dal link di recupero password o da quello d'invito
// ha i token nel fragment, e HashRouter li cancellerebbe al primo redirect. Sul
// giro normale la funzione esce subito.
void consumeAuthLink().then(() =>
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* HashRouter: GitHub Pages non fa fallback SPA. Si passa a
              BrowserRouter quando la dashboard avrà un dominio proprio. */}
          <HashRouter>
            <ToastProvider>
              {/* Come in AppProviders sull'app: il boundary è il più interno,
                  così il suo fallback può ancora contare su sessione e toast. */}
              <AppErrorBoundary>
                <App />
              </AppErrorBoundary>
            </ToastProvider>
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  )
);
