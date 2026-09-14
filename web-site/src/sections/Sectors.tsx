import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * I settori come chip. È la sezione che smentisce il nome del prodotto:
 * "Waitr" suona ristorazione, ma il modo di organizzare i turni è lo stesso in
 * un hotel, in una discoteca o in un'agenzia di eventi.
 */
export function Sectors() {
  return (
    <Section
      id="settori"
      tone="raised"
      eyebrow={t.sectors.eyebrow}
      title={t.sectors.title}
      lead={t.sectors.lead}
    >
      <Reveal className="mt-8 flex flex-wrap gap-2.5 sm:mt-10">
        {t.sectors.items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-border-2 px-4 py-2.5 text-t1"
          >
            {item}
          </span>
        ))}
      </Reveal>
    </Section>
  );
}
