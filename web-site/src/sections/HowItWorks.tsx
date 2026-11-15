import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * Quattro passi numerati. La linea che li unisce compare solo da `md` in su:
 * in colonna singola il numero basta già a dire l'ordine, e una linea
 * verticale disegnata a metà si romperebbe alla prima traduzione più lunga.
 */
export function HowItWorks() {
  return (
    <Section
      id="come-funziona"
      eyebrow={t.how.eyebrow}
      title={t.how.title}
    >
      <ol className="mt-10 grid gap-8 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {t.how.steps.map((step, i) => (
          <Reveal as="li" key={step.title} delay={i * 80} className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-gold font-mono text-sm text-gold">
                {String(i + 1).padStart(2, "0")}
              </span>
              {i < t.how.steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="hidden h-px flex-1 bg-border-2 lg:block"
                />
              )}
            </div>
            <h3 className="mt-4 text-[length:var(--text-fluid-h3)] font-semibold">
              {step.title}
            </h3>
            <p className="mt-2 text-t2">{step.body}</p>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
