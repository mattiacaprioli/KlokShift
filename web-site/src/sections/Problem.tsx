import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * Il riconoscimento del problema, prima delle feature: tre righe numerate,
 * niente icone. Chi si riconosce qui legge il resto con un'altra attenzione.
 */
export function Problem() {
  return (
    <Section
      id="problema"
      tone="raised"
      eyebrow={t.problem.eyebrow}
      title={t.problem.title}
      lead={t.problem.lead}
    >
      <ul className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:mt-14 sm:grid-cols-3">
        {t.problem.items.map((item, i) => (
          <Reveal
            as="li"
            key={item.title}
            delay={i * 80}
            className="bg-bg-card p-6"
          >
            <p className="font-mono text-xs tracking-[0.18em] text-t4">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-3 text-[length:var(--text-fluid-h3)] font-semibold">
              {item.title}
            </h3>
            <p className="mt-2 text-t2">{item.body}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
