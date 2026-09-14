import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon, type IconName } from "../ui/Icon";
import { t } from "../content";

/*
 * Telefono e browser: due card, nient'altro. Serve a togliere il dubbio "devo
 * installare qualcosa?" prima che arrivi alle FAQ.
 */
const ICONS: IconName[] = ["phone", "desktop"];

export function Platforms() {
  return (
    <Section id="piattaforme" eyebrow={t.platforms.eyebrow} title={t.platforms.title}>
      <ul className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2">
        {t.platforms.items.map((item, i) => (
          <Reveal
            as="li"
            key={item.title}
            delay={i * 80}
            className="rounded-2xl border border-border bg-bg-card p-6 sm:p-8"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border-gold text-gold">
              <Icon name={ICONS[i]} />
            </span>
            <h3 className="mt-5 text-[length:var(--text-fluid-h3)] font-semibold">
              {item.title}
            </h3>
            <p className="mt-2 text-t2">{item.body}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
