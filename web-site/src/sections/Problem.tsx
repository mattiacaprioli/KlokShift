import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon } from "../ui/Icon";
import { t } from "../content";

/*
 * Il riconoscimento del problema, prima delle feature: tre righe numerate,
 * ognuna col suo «dopo» in oro. Chi si riconosce qui legge il resto con
 * un'altra attenzione, e vede subito il tempo che si riprende.
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
            <p className="mt-2 text-t3">{item.body}</p>
            <p className="mt-4 flex items-start gap-2.5 border-t border-border pt-4 text-t1">
              <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <span>{item.after}</span>
            </p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
