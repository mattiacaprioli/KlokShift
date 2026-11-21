import { useEffect } from "react";
import { Container } from "../ui/Container";
import { Eyebrow } from "../ui/Section";
import { Logo } from "../ui/Logo";
import { Button } from "../ui/Button";
import { Footer } from "./Footer";
import { t } from "../content";

/*
 * Dove atterra il link di conferma dell'email mandato da chi si registra
 * **dall'app** (`emailRedirectTo` in `src/features/auth/redirects.ts`).
 *
 * Prima quel link finiva sul Site URL, cioè la dashboard delle sedi: un
 * dipendente al telefono si trovava davanti il login da gestore. Qui gli si
 * dice soltanto che è fatta e lo si rimanda nell'app, dove la schermata
 * «Controlla la posta» lo fa entrare da sola (`signup-account.tsx`).
 *
 * La conferma l'ha già fatta Supabase prima del redirect: questa pagina non
 * tocca la sessione e non importa il client Supabase.
 *
 * ⚠️ L'URL va nei Redirect URLs di Supabase Auth, altrimenti il link ripiega
 * sul Site URL e si torna al comportamento di prima.
 */

export type ConfirmOutcome = "ok" | "expired" | "error";

/**
 * L'esito dal fragment che Supabase aggiunge al redirect: i token se è andata
 * bene, `error_code` se no. Un link già usato o scaduto è `otp_expired`.
 */
export function readConfirmOutcome(hash: string): ConfirmOutcome {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code");
  if (code === "otp_expired") return "expired";
  if (code || params.get("error")) return "error";
  return "ok";
}

/** Apre l'app installata (lo `scheme` di `app.json`) sulla schermata d'accesso. */
const APP_LINK = "klokshift://login";

export function EmailConfirmedPage({ outcome }: { outcome: ConfirmOutcome }) {
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, []);

  const c = t.emailConfirmed;
  const copy = outcome === "ok" ? c.ok : outcome === "expired" ? c.expired : c.error;

  return (
    <>
      <header className="border-b border-border">
        <Container className="flex items-center justify-between py-5">
          <a href="./" className="focus-gold rounded">
            <Logo />
          </a>
        </Container>
      </header>

      <main>
        <Container className="py-14 sm:py-20">
          <div className="max-w-2xl">
            <Eyebrow>{c.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[length:var(--text-fluid-h2)] font-semibold">
              {copy.title}
            </h1>
            <p className="mt-4 text-[length:var(--text-fluid-lead)] text-t2">
              {copy.body}
            </p>
          </div>

          <div className="mt-10">
            <Button href={APP_LINK} variant="primary">
              {c.openApp}
            </Button>
            {/* Solo a conferma riuscita: negli altri casi l'account potrebbe
                non essere attivo. */}
            {outcome === "ok" ? (
              <p className="mt-4 max-w-2xl text-sm text-t3">{c.otherDevice}</p>
            ) : null}
          </div>
        </Container>
      </main>

      <Footer />
    </>
  );
}
