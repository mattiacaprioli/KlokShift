import { useEffect } from "react";
import { Container } from "../ui/Container";
import { Eyebrow } from "../ui/Section";
import { Logo } from "../ui/Logo";
import { Button } from "../ui/Button";
import { Footer } from "./Footer";
import { ANDROID_URL, IOS_URL, SIGNUP_URL } from "../config";
import { t } from "../content";

/*
 * L'atterraggio dell'email d'invito (`invito.html`).
 *
 * Chi arriva qui ha già deciso: qualcuno l'ha invitato e lui ha aperto il link.
 * Gli manca l'app e — soprattutto — sapere che deve registrarsi con **quell'**
 * indirizzo, perché è il match dell'email a collegarlo a ciò che il locale ha
 * già preparato. Tutto il resto della pagina è contorno; quella frase è la
 * pagina.
 *
 * Due inviti, una pagina: `?r=gestione` è il collaboratore che gestirà il
 * locale, tutto il resto è la persona in organico. Un secondo entry HTML
 * avrebbe voluto dire un secondo file in `rollupOptions.input` e due `<head>`
 * da tenere allineati, per una pagina che cambia solo il copy.
 *
 * ⚠️ Il parametro **non autorizza niente**: decide solo quale testo leggere. È
 * l'email confermata a collegare l'account (`link_venue_access_for_user`), e
 * chi arriva qui con il parametro sbagliato vede la pagina sbagliata, non un
 * accesso sbagliato.
 *
 * Niente `<Nav />`: le sue voci sono ancore verso sezioni che qui non esistono.
 */
export function InvitePage() {
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, []);

  // Letto una volta al render: la pagina non cambia mentre la si guarda.
  const isManager =
    new URLSearchParams(window.location.search).get("r") === "gestione";
  const c = isManager ? t.inviteManager : t.invite;

  return (
    <>
      <header className="border-b border-border">
        <Container className="flex items-center justify-between py-5">
          <a href="./" className="focus-gold rounded">
            <Logo />
          </a>
          <Button href="./" variant="quiet" size="sm">
            {t.invite.homeLabel}
          </Button>
        </Container>
      </header>

      <main>
        <Container className="py-14 sm:py-20">
          <div className="max-w-2xl">
            <Eyebrow>{c.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[length:var(--text-fluid-h1)] font-semibold">
              {c.title}
            </h1>
            <p className="mt-4 text-[length:var(--text-fluid-lead)] text-t2">
              {c.lead}
            </p>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-3">
            {c.steps.map((step, i) => (
              <li
                key={step.title}
                className="rounded-2xl border border-border bg-bg-card p-6"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-gold font-mono text-sm text-gold">
                  {i + 1}
                </span>
                <h2 className="mt-4 text-lg font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm text-t2">{step.body}</p>
              </li>
            ))}
          </ol>

          {/* La frase da cui dipende tutto il meccanismo: chi si registra con un
              altro indirizzo entra in topWaitr ma non nell'organico. */}
          <div className="mt-8 rounded-2xl border border-border-gold bg-bg-card p-6">
            <h2 className="font-semibold text-gold">
              {c.calloutTitle}
            </h2>
            <p className="mt-2 text-t2">{c.calloutBody}</p>
          </div>

          {/* Il collaboratore non aspetta gli store: la dashboard esiste già, e
              da una scrivania è anche il posto giusto per fare i turni. */}
          {isManager ? <WebCta /> : null}

          <StoreBadges />

          <section className="mt-14">
            <h2 className="text-[length:var(--text-fluid-h3)] font-semibold">
              {c.whatTitle}
            </h2>
            <ul className="mt-4 flex flex-col gap-2">
              {c.whatItems.map((item) => (
                <li key={item} className="flex gap-3 text-t2">
                  <span aria-hidden className="text-gold">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </Container>
      </main>

      <Footer />
    </>
  );
}

/* Il rimando alla dashboard, solo per chi è stato invitato a gestire. */
function WebCta() {
  return (
    <div className="mt-8 rounded-2xl border border-border bg-bg-card p-6">
      <h2 className="font-semibold">{t.inviteManager.webTitle}</h2>
      <p className="mt-2 text-t2">{t.inviteManager.webBody}</p>
      <div className="mt-4">
        <Button href={SIGNUP_URL} variant="primary">
          {t.inviteManager.webLabel}
        </Button>
      </div>
    </div>
  );
}

/*
 * I due badge. Finché le schede store non esistono (M8) restano spenti e non
 * cliccabili, con sotto la riga «in arrivo»: nasconderli lascerebbe la pagina
 * senza una risposta alla domanda «e adesso?». Si accendono valorizzando
 * `EXPO_PUBLIC_IOS_URL` / `EXPO_PUBLIC_ANDROID_URL`, senza toccare il copy.
 */
function StoreBadges() {
  const live = Boolean(IOS_URL || ANDROID_URL);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap gap-3">
        <StoreBadge href={IOS_URL} label={t.invite.iosLabel} />
        <StoreBadge href={ANDROID_URL} label={t.invite.androidLabel} />
      </div>
      {live ? null : (
        <p className="mt-3 text-sm text-t3">{t.invite.storesSoon}</p>
      )}
    </div>
  );
}

function StoreBadge({ href, label }: { href: string; label: string }) {
  if (!href) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex min-h-11 cursor-default items-center justify-center rounded-full border border-border px-6 text-base font-medium text-t4"
      >
        {label}
      </span>
    );
  }
  return (
    <Button href={href} variant="primary">
      {label}
    </Button>
  );
}
