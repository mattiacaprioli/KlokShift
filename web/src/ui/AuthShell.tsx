import type { PropsWithChildren } from "react";
import { SupportLine } from "./SupportLine";

/**
 * Cornice delle schermate fuori sessione (accesso, registrazione, conferma
 * email): stesso marchio e stessa misura, così passando da una all'altra non si
 * muove niente sullo schermo.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold" />
          <h1 className="font-serif text-3xl text-t1">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-t3">{subtitle}</p> : null}
        </div>
        {children}
        <SupportLine className="mt-8" />
      </div>
    </main>
  );
}

/** Pannello dei form fuori sessione: il `<form>` lo mette chi lo usa. */
export function AuthPanel({ children }: PropsWithChildren) {
  return (
    <div className="rounded-2xl border border-border-2 bg-bg-card p-6">
      {children}
    </div>
  );
}
