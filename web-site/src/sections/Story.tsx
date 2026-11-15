import { useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { Container } from "../ui/Container";
import { Reveal } from "../ui/Reveal";
import { cn } from "../ui/cn";
import { StoryVisual } from "../story/StoryVisual";
import { activeStep } from "../story/progress";
import { t } from "../content";

/*
 * «Come funziona», raccontato come una settimana sola che scende con chi legge
 * (spec 2026-11-15-sito-vetrina-wow-design.md, pezzo 2).
 *
 * Da `lg`: i passi scorrono a sinistra, l'oggetto a destra resta fermo
 * (sticky) e cambia forma col passo attivo, che si ricava da quanto dei passi
 * è passato sullo schermo. Sotto `lg` niente sticky — sui telefoni
 * si inceppa — e ogni passo porta sotto di sé il proprio oggetto, già nello
 * stato finale.
 *
 * Il testo esiste una volta sola: gli oggetti sono aria-hidden.
 */
const STEPS = t.story.steps.length;

export function Story() {
  const stepsRef = useRef<HTMLDivElement>(null);
  // -1 finché i passi non arrivano al centro dello schermo (vedi `activeStep`).
  const [active, setActive] = useState(-1);
  const { scrollYProgress } = useScroll({
    target: stepsRef,
    // Parte quando l'inizio dei passi supera l'80% dello schermo: chi ci
    // atterra con «Guarda come funziona» vede subito la bozza diventare pubblicata.
    offset: ["start 0.8", "end center"],
  });
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    setActive(activeStep(progress, STEPS));
  });

  return (
    <section
      id="come-funziona"
      aria-labelledby="come-funziona-title"
      className="scroll-mt-20 pt-16 pb-8 sm:pt-24 lg:pt-0 lg:pb-0"
    >
      <Container>
        {/* Il titolo sta nella colonna dei passi: così, da `lg`, la colonna
            dell'oggetto parte dall'inizio della sezione e chi ci arriva con
            «Guarda come funziona» vede subito l'oggetto intero. */}
        <div ref={stepsRef} className="lg:grid lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <Reveal className="max-w-3xl lg:pt-24">
              <h2
                id="come-funziona-title"
                className="text-[length:var(--text-fluid-h2)] font-semibold"
              >
                {t.story.title}
              </h2>
            </Reveal>

            <ol className="mt-10 flex flex-col gap-16 lg:mt-0 lg:gap-0">
              {t.story.steps.map((step, i) => (
                <li
                  key={step.title}
                  className="lg:flex lg:min-h-[75vh] lg:flex-col lg:justify-center"
                >
                  <div
                    className={cn(
                      "transition-opacity duration-500",
                      i !== active && "lg:opacity-35"
                    )}
                  >
                    <p className="text-t3">{step.before}</p>
                    <h3 className="mt-4 flex items-baseline gap-3 text-[length:var(--text-fluid-h2)] font-semibold">
                      <span className="font-sans text-base font-semibold text-gold tabular-nums">
                        {i + 1}
                      </span>
                      {step.title}
                    </h3>
                    <p className="mt-3 max-w-md text-[length:var(--text-fluid-lead)] text-t2">
                      {step.body}
                    </p>
                  </div>
                  <Reveal className="mt-8 lg:hidden">
                    <StoryVisual step={i} still />
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>

          <div className="hidden lg:col-span-7 lg:block">
            {/* Sotto la barra in alto (5rem): l'oggetto è centrato nello
                spazio che si vede davvero. */}
            <div className="sticky top-20 flex h-[calc(100vh-5rem)] items-center">
              <StoryVisual step={active} />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
