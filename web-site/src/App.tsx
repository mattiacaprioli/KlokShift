import { useEffect } from "react";
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Problem } from "./sections/Problem";
import { ForVenues } from "./sections/ForVenues";
import { ForPros } from "./sections/ForPros";
import { HowItWorks } from "./sections/HowItWorks";
import { Sectors } from "./sections/Sectors";
import { Platforms } from "./sections/Platforms";
import { Plans } from "./sections/Plans";
import { Faq } from "./sections/Faq";
import { FinalCta } from "./sections/FinalCta";
import { Footer } from "./sections/Footer";
import { MobileCta } from "./sections/MobileCta";
import { t } from "./content";

/*
 * L'ordine delle sezioni è l'argomentazione: problema → cosa fa per chi decide
 * → cosa fa per chi lavora → come si comincia → per chi → dove si usa → piani
 * → obiezioni → invito.
 */
export function App() {
  // La lingua la dichiara il contenuto, non il markup: quando arriveranno `en`
  // e `es` non ci sarà un `lang="it"` dimenticato nell'HTML.
  useEffect(() => {
    document.documentElement.lang = t.lang;
  }, []);

  return (
    <>
      <a
        href="#contenuto"
        className="focus-gold sr-only rounded-full bg-gold px-4 py-2 text-gold-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-60"
      >
        Vai al contenuto
      </a>
      <Nav />
      <main id="contenuto">
        <Hero />
        <Problem />
        <ForVenues />
        <ForPros />
        <HowItWorks />
        <Sectors />
        <Platforms />
        <Plans />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileCta />
    </>
  );
}
