import { useEffect } from "react";
import { Container } from "../ui/Container";
import { Eyebrow } from "../ui/Section";
import { Logo } from "../ui/Logo";
import { Button } from "../ui/Button";
import { Footer } from "./Footer";
import { ANDROID_URL, IOS_URL } from "../config";
import { t } from "../content";

/*
 * L'atterraggio dell'email d'invito (`invito.html`).
 *
 * Chi arriva qui ha già deciso: un locale l'ha messo in organico e lui ha
 * aperto il link. Gli manca l'app e — soprattutto — sapere che deve registrarsi
 * con **quell'** indirizzo, perché è il match dell'email a collegarlo alla
 * scheda che il locale ha già preparato. Tutto il resto della pagina è
 * contorno; quella frase è la pagina.
 *
 * Niente `<Nav />`: le sue voci sono ancore verso sezioni che qui non esistono.
 * E nessun rimando alla dashboard web come alternativa all'app: la dashboard è
 * per i locali, e un professionista che ci si registrasse finirebbe su
 * `NotForWaitersPage`.
 */
export function InvitePage() {
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, []);

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
            <Eyebrow>{t.invite.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[length:var(--text-fluid-h1)] font-semibold">
              {t.invite.title}
            </h1>
            <p className="mt-4 text-[length:var(--text-fluid-lead)] text-t2">
              {t.invite.lead}
            </p>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-3">
            {t.invite.steps.map((step, i) => (
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
              {t.invite.calloutTitle}
            </h2>
            <p className="mt-2 text-t2">{t.invite.calloutBody}</p>
          </div>

          <StoreBadges />

          <section className="mt-14">
            <h2 className="text-[length:var(--text-fluid-h3)] font-semibold">
              {t.invite.whatTitle}
            </h2>
            <ul className="mt-4 flex flex-col gap-2">
              {t.invite.whatItems.map((item) => (
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
