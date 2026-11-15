import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { WeekBoard } from "../mock/WeekBoard";
import { WEEK_SHIFTS } from "../mock/week";
import { t } from "../content";
import { SIGNUP_URL } from "../config";

/*
 * Primo schermo: la settimana dei turni che prende vita è il «wow» della home
 * (spec 2026-11-15-sito-vetrina-wow-design.md). Su mobile testo sopra e
 * settimana sotto, ridotta a tre giorni; da `xl` la settimana a destra, in
 * leggera prospettiva. Nessuna immagine da scaricare: il mock è HTML.
 */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28">
      {/* Alone dorato dietro la settimana: decorativo, non intercetta i click. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 right-[-10rem] h-[36rem] w-[44rem] rounded-full bg-gold/10 blur-3xl"
      />
      <Container className="relative">
        <div className="grid items-center gap-12 xl:grid-cols-12 xl:gap-10">
          <div className="xl:col-span-5">
            <h1 className="text-[length:var(--text-fluid-hero)] font-semibold xl:text-[3.6rem]">
              {t.hero.title}
            </h1>
            <p className="mt-5 max-w-xl text-[length:var(--text-fluid-lead)] text-t2">
              {t.hero.lead}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button href={SIGNUP_URL} className="whitespace-nowrap">
                {t.hero.ctaPrimary}
              </Button>
              <Button href="#come-funziona" variant="quiet" className="whitespace-nowrap sm:px-3">
                {t.hero.ctaSecondary}
              </Button>
            </div>
            <p className="mt-4 text-sm text-t3">{t.hero.note}</p>
          </div>

          <div className="xl:col-span-7">
            <WeekBoard
              shifts={WEEK_SHIFTS}
              label={t.hero.boardLabel}
              toast={t.hero.toast}
              intro
              tilt
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
