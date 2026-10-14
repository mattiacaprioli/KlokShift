import type { PropsWithChildren } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { reportError } from "../lib/reportError";
import { Button } from "./primitives";

/**
 * Fallback della dashboard: la stessa promessa di ErrorFallback sull'app.
 *
 * Il messaggio dell'errore non si mostra: è inglese, tecnico e a volte parla
 * di com'è fatto il database. Il dettaglio va a `reportError` (onError qui sotto).
 */
function DashboardErrorFallback({ resetErrorBoundary }: FallbackProps) {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-2 bg-bg-card p-6 text-center">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
        <h1 className="font-serif text-2xl text-t1">
          Qualcosa è andato storto
        </h1>
        <p className="mt-2 text-sm leading-6 text-t3">
          La pagina si è interrotta. I dati sul server non sono stati toccati.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="gold" onClick={resetErrorBoundary}>
            Riprova
          </Button>
          <Button
            onClick={() => {
              // Se l'errore è nato proprio sulla home, il cambio di rotta non
              // scatta e resetKeys non farebbe niente: il reset esplicito serve.
              navigate("/");
              resetErrorBoundary();
            }}
          >
            Torna alla dashboard
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * Rete di sicurezza della dashboard: senza, un errore di render è una pagina
 * bianca, senza modo di ripartire e senza traccia di cosa sia successo.
 *
 * Sta dentro al router (usa `navigate`) e si azzera da sé quando cambia rotta:
 * un errore su una pagina non blocca tutte le altre.
 */
export function AppErrorBoundary({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      FallbackComponent={DashboardErrorFallback}
      resetKeys={[pathname]}
      onError={(error) => reportError(error, "render")}
    >
      {children}
    </ErrorBoundary>
  );
}
