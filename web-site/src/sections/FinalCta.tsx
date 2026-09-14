import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";
import { SIGNUP_URL, LOGIN_URL } from "../config";

/*
 * Chiusura. Ha un `id` perché la barra CTA fissa su mobile si nasconde quando
 * questa sezione entra in vista: due CTA identiche nello stesso schermo sono
 * rumore, non insistenza.
 */
export function FinalCta() {
  return (
    <section id="inizia" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <Reveal className="relative overflow-hidden rounded-3xl border border-border-gold bg-bg-card px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-[length:var(--text-fluid-h2)] font-semibold">
              {t.finalCta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[length:var(--text-fluid-lead)] text-t2">
              {t.finalCta.lead}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button href={SIGNUP_URL} className="w-full sm:w-auto">
                {t.finalCta.cta}
              </Button>
              <Button
                href={LOGIN_URL}
                variant="ghost"
                className="w-full sm:w-auto"
              >
                {t.finalCta.secondary}
              </Button>
            </div>
            <p className="mt-6 text-sm text-t3">{t.finalCta.note}</p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
