import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { Icon, type IconName } from "../ui/Icon";
import { Shot } from "../mock/Shot";
import { ConfirmMock } from "../mock/ConfirmMock";
import { t } from "../content";

/*
 * Il lato professionista. Layout a due colonne da `lg`: il telefono a sinistra
 * (è un'app da telefono) e l'elenco a destra. Sotto `lg` il mockup viene dopo
 * il testo, perché su uno schermo piccolo la promessa deve arrivare prima
 * dell'illustrazione.
 */
const ICONS: IconName[] = ["check", "clock", "swap", "eye"];

export function ForPros() {
  return (
    <Section
      id="team"
      eyebrow={t.pro.eyebrow}
      title={t.pro.title}
      lead={t.pro.lead}
    >
      <div className="mt-10 grid items-center gap-12 sm:mt-14 lg:grid-cols-12 lg:gap-10">
        <div className="order-2 lg:order-1 lg:col-span-5">
          <Shot kind="phone" alt={t.pro.shotAlt}>
            <ConfirmMock />
          </Shot>
        </div>

        <ul className="order-1 flex flex-col gap-6 lg:order-2 lg:col-span-7">
          {t.pro.features.map((feature, i) => (
            <Reveal as="li" key={feature.title} delay={i * 70}>
              <div className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-gold text-gold">
                  <Icon name={ICONS[i]} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-[length:var(--text-fluid-h3)] font-semibold">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-t2">{feature.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  );
}
