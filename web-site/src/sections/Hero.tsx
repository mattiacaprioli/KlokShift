import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { Eyebrow } from "../ui/Section";
import { Shot } from "../mock/Shot";
import { AgendaMock } from "../mock/AgendaMock";
import { t } from "../content";
import { SIGNUP_URL } from "../config";

/*
 * Primo schermo. Su mobile è una colonna (testo, poi telefono); da `lg` il
 * telefono passa a destra. Nessuna immagine pesante qui dentro: il mockup è
 * HTML, quindi il primo schermo non aspetta nessun download.
 */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* Alone dorato: decorativo, dietro a tutto, non intercetta i click. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
      />
      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <Eyebrow>{t.hero.eyebrow}</Eyebrow>
            <h1 className="mt-4 text-[length:var(--text-fluid-hero)] font-semibold">
              {t.hero.title}
            </h1>
            <p className="mt-5 max-w-xl text-[length:var(--text-fluid-lead)] text-t2">
              {t.hero.lead}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href={SIGNUP_URL}>{t.hero.ctaPrimary}</Button>
              <Button href="#come-funziona" variant="ghost">
                {t.hero.ctaSecondary}
              </Button>
            </div>
            <p className="mt-4 text-sm text-t3">{t.hero.note}</p>
          </div>

          <div className="lg:col-span-6">
            <Shot kind="phone" alt={t.hero.shotAlt}>
              <AgendaMock />
            </Shot>
          </div>
        </div>
      </Container>
    </section>
  );
}
