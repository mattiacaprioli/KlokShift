import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { t } from "../content";
import { SIGNUP_URL } from "../config";
import type { Price } from "../content/types";

/*
 * Prezzi: due card (annuale e mensile) e sotto quello che includono entrambe.
 *
 * L'annuale è quella evidenziata, con il risparmio nel badge: la differenza
 * col mensile è l'argomento, e deve leggersi prima delle cifre. Il prezzo è
 * per sede e mai per persona, quindi la lista dell'incluso apre con i
 * dipendenti illimitati.
 *
 * ⚠️ Solo qui e nella dashboard web: l'app non mostra prezzi né link al sito
 * (App Store 3.1.3, vedi `(manager)/pro.tsx`).
 */
function PriceCard({
  plan,
  badge,
  highlighted,
  delay,
}: {
  plan: Price;
  badge?: string;
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
        {badge ? (
          <span className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-gold-ink">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-[length:var(--text-fluid-h2)] font-semibold">
          {plan.price}
        </span>
        <span className="text-t2">{plan.period}</span>
      </p>
      <p className="mt-2 text-sm text-t3">{plan.billed}</p>
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
        <PriceCard plan={t.plans.yearly} badge={t.plans.yearly.badge} highlighted />
        <PriceCard plan={t.plans.monthly} delay={80} />
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
