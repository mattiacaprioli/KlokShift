import type { PropsWithChildren, ReactNode } from "react";
import { SupportLine } from "./SupportLine";

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? "https://klokshift.com";

/**
 * Cornice delle schermate fuori sessione (accesso, registrazione, conferma
 * email, invito, nuova password, area del fondatore): stesso marchio e stessa
 * misura, così passando da una all'altra non si muove niente sullo schermo.
 *
 * Con `aside` (la registrazione) lo schermo si divide in due da `xl`: il form a
 * sinistra, a destra perché vale la pena — come 7shifts, Homebase e Deputy.
 * Sotto `xl` l'aside non c'è: sul telefono conta il form, e quello che serve
 * sapere (la prova senza carta) sta già nel sottotitolo. Senza `aside` (chi
 * torna ad accedere) resta una colonna sola: deve solo entrare.
 */
export function AuthShell({
  title,
  subtitle,
  aside,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string; aside?: ReactNode }>) {
  return (
    <div
      className={
        aside
          ? "relative min-h-dvh overflow-hidden xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"
          : "relative min-h-dvh overflow-hidden"
      }
    >
      {/* Lo stesso alone dorato del sito, dietro il form: arredo, niente click. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-3xl ${aside ? "xl:left-1/4" : ""}`}
      />

      <main className="relative flex min-h-dvh flex-col px-6 py-5">
        <a
          href={SITE_URL}
          className="focus-gold self-start rounded-lg font-serif text-xl leading-none font-semibold tracking-tight text-t1"
        >
          Klok<span className="text-gold">Shift</span>
        </a>

        <div className="flex flex-1 items-center justify-center py-6">
          <div className="w-full max-w-sm">
            <div className="mb-6 text-center">
              <h1 className="font-serif text-[2rem] leading-tight tracking-tight text-balance text-t1">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-sm leading-6 text-pretty text-t3">{subtitle}</p>
              ) : null}
            </div>
            {children}
            <SupportLine className="mt-6" />
          </div>
        </div>
      </main>

      {aside ? (
        <aside className="relative hidden border-l border-border bg-bg-1/40 xl:flex xl:items-center xl:justify-center xl:p-12">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** Pannello dei form fuori sessione: il `<form>` lo mette chi lo usa. */
export function AuthPanel({ children }: PropsWithChildren) {
  return (
    <div className="rounded-2xl border border-border-2 bg-bg-card/80 p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur-sm">
      {children}
    </div>
  );
}
