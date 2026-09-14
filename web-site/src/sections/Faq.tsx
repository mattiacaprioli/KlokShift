import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * FAQ con `<details>`: apertura e accessibilità le dà il browser, e tutta la
 * riga è cliccabile senza aggiungere JS. `name` uguale su tutte le voci
 * significa che se ne apre una sola alla volta, dove il browser lo supporta.
 */
export function Faq() {
  return (
    <Section id="faq" eyebrow={t.faq.eyebrow} title={t.faq.title}>
      <div className="mt-10 max-w-3xl divide-y divide-border border-y border-border sm:mt-14">
        {t.faq.items.map((item, i) => (
          <Reveal key={item.q} delay={i * 50}>
            <details name="faq" className="group">
              <summary className="focus-gold flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[length:var(--text-fluid-h3)] font-medium marker:content-['']">
                {item.q}
                <span
                  aria-hidden="true"
                  className="relative h-5 w-5 shrink-0 text-gold"
                >
                  <span className="absolute top-1/2 left-0 h-px w-5 -translate-y-1/2 bg-current" />
                  <span className="absolute top-1/2 left-0 h-px w-5 -translate-y-1/2 rotate-90 bg-current transition-transform group-open:rotate-0" />
                </span>
              </summary>
              <p className="pb-5 text-t2">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
