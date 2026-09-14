import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon } from "../ui/Icon";
import { t } from "../content";

/*
 * Piani, non prezzi.
 *
 * ⚠️ Qui non va nessuna cifra finché il modello non è deciso (`TASKS.md`): due
 * colonne che dicono cosa resta gratis e cosa finirà nel piano Pro, con lo
 * stesso tono della schermata `(manager)/pro.tsx` dell'app. Il giorno in cui i
 * prezzi esistono, questa sezione diventa una tabella — non prima.
 */
export function Plans() {
  return (
    <Section
      id="piani"
      tone="raised"
      eyebrow={t.plans.eyebrow}
      title={t.plans.title}
      lead={t.plans.lead}
    >
      <div className="mt-10 grid gap-4 sm:mt-14 lg:grid-cols-2">
        <Reveal className="rounded-2xl border border-border-gold bg-bg-0/40 p-6 sm:p-8">
          <h3 className="font-mono text-xs tracking-[0.18em] text-gold uppercase">
            {t.plans.freeTitle}
          </h3>
          <ul className="mt-5 flex flex-col gap-3">
            {t.plans.freeItems.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={80} className="rounded-2xl border border-border bg-bg-0/40 p-6 sm:p-8">
          <h3 className="font-mono text-xs tracking-[0.18em] text-t3 uppercase">
            {t.plans.proTitle}
          </h3>
          <ul className="mt-5 flex flex-col gap-3 text-t2">
            {t.plans.proItems.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Icon name="clock" className="mt-0.5 h-5 w-5 shrink-0 text-t3" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-t3">{t.plans.note}</p>
        </Reveal>
      </div>
    </Section>
  );
}
