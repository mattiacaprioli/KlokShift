import { Section } from "../ui/Section";
import { Card } from "../ui/Card";
import { Reveal } from "../ui/Reveal";
import { Icon, type IconName } from "../ui/Icon";
import { Shot } from "../mock/Shot";
import { PlanningMock } from "../mock/PlanningMock";
import { HoursMock } from "../mock/HoursMock";
import { t } from "../content";

/*
 * La sezione più lunga del sito: è il lato che paga e che decide.
 * Sei card in griglia — una colonna sul telefono, due dal tablet, tre dal
 * laptop — e sotto i due mockup della dashboard, che sono la prova che le due
 * card più importanti (planning e ore) esistono davvero.
 *
 * L'ordine delle icone segue l'ordine di `content.venue.features`: se una
 * feature cambia posto lì, va spostata anche qui.
 */
const ICONS: IconName[] = [
  "people",
  "calendar",
  "grid",
  "clock",
  "document",
  "tag",
];

export function ForVenues() {
  return (
    <Section
      id="funzioni"
      tone="raised"
      eyebrow={t.venue.eyebrow}
      title={t.venue.title}
      lead={t.venue.lead}
    >
      <ul className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
        {t.venue.features.map((feature, i) => (
          <Reveal as="li" key={feature.title} delay={(i % 3) * 80}>
            <Card
              title={feature.title}
              body={feature.body}
              icon={<Icon name={ICONS[i]} />}
            />
          </Reveal>
        ))}
      </ul>

      <Reveal className="mt-12 sm:mt-16">
        <Shot kind="desktop" alt={t.venue.shotPlanningAlt}>
          <PlanningMock />
        </Shot>
      </Reveal>

      <Reveal className="mt-6 lg:mx-auto lg:max-w-3xl">
        <Shot kind="desktop" alt={t.venue.shotHoursAlt}>
          <HoursMock />
        </Shot>
      </Reveal>
    </Section>
  );
}
