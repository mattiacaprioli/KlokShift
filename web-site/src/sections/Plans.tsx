import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { t } from "../content";
import { SIGNUP_URL } from "../config";
import type { Price } from "../content/types";

/*
 * Prezzi: due card per dimensione del team e sotto quello che includono entrambe.
 *
 * Il limite di persone e la sede inclusa devono leggersi dentro ogni card:
 * sono le due informazioni che distinguono i piani e non possono dipendere
 * dal testo introduttivo o dalle FAQ.
 *
 * ⚠️ Solo qui e nella dashboard web: l'app non mostra prezzi né link al sito
 * (App Store 3.1.3, vedi `(manager)/pro.tsx`).
 */
function PriceCard({
  plan,
  highlighted,
  delay,
}: {
  plan: Price;
  highlighted?: boolean;
  delay?: number;
}) {
  return (
    <Reveal
      delay={delay}
      className={cn(
        "relative rounded-2xl border bg-bg-0/40 p-6 sm:p-8",
        highlighted ? "border-border-gold" : "border-border"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          className={cn(
            "font-mono text-xs tracking-[0.18em] uppercase",
            highlighted ? "text-gold" : "text-t3"
          )}
        >
          {plan.name}
        </h3>
        {plan.badge ? (
          <span className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-gold-ink">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-[length:var(--text-fluid-h2)] font-semibold">
          {plan.price}
        </span>
        <span className="text-t2">{plan.period}</span>
      </p>
      <ul className="mt-4 space-y-2 text-sm text-t2">
        {plan.details.map((detail) => (
          <li key={detail} className="flex items-start gap-2">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <span>{detail}</span>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

export function Plans() {
  return (
    <Section
      id="prezzi"
      tone="raised"
      eyebrow={t.plans.eyebrow}
      title={t.plans.title}
      lead={t.plans.lead}
    >
      <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2">
        {t.plans.options.map((plan, index) => (
          <PriceCard
            key={plan.name}
            plan={plan}
            highlighted={index === 0}
            delay={index * 80}
          />
        ))}
      </div>

      <Reveal className="mt-4 rounded-2xl border border-border bg-bg-0/40 p-6 sm:p-8">
        <h3 className="font-mono text-xs tracking-[0.18em] text-t3 uppercase">
          {t.plans.includedTitle}
        </h3>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {t.plans.included.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-border pt-5 text-t2">{t.plans.extraVenue}</p>
      </Reveal>

      <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
        <Button href={SIGNUP_URL}>{t.plans.cta}</Button>
        <p className="text-sm text-t3">{t.plans.note}</p>
      </div>
    </Section>
  );
}
