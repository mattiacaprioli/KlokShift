import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Rest } from "./sections/Rest";
import { Story } from "./sections/Story";
import { Sectors } from "./sections/Sectors";
import { Plans } from "./sections/Plans";
import { Faq } from "./sections/Faq";
import { FinalCta } from "./sections/FinalCta";
import { Footer } from "./sections/Footer";
import { MobileCta } from "./sections/MobileCta";
import { t } from "./content";

/*
 * L'ordine delle sezioni è l'argomentazione: la settimana che prende vita →
 * per chi → la stessa settimana raccontata dalla bozza al consulente → il
 * resto, in breve → prezzi → obiezioni → invito. Il «wow» sta nelle prime tre;
 * dopo, la pagina resta calma apposta (spec 2026-11-15-sito-vetrina-wow-design.md).
 */
export function App() {
  // La lingua la dichiara il contenuto, non il markup: quando arriveranno `en`
  // e `es` non ci sarà un `lang="it"` dimenticato nell'HTML.
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, []);

  // `reducedMotion="user"`: chi ha chiesto meno movimento non vede né morph né
  // spostamenti, solo cambi di stato.
  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#contenuto"
        className="focus-gold sr-only rounded-full bg-gold px-4 py-2 text-gold-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-60"
      >
        Vai al contenuto
      </a>
      <Nav />
      <main id="contenuto">
        <Hero />
        <Sectors />
        <Story />
        <Rest />
        <Plans />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileCta />
    </MotionConfig>
  );
}
