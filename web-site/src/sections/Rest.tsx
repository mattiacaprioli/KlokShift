import { Section } from "../ui/Section";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * Tutto quello che la storia non racconta, in righe brevi. Volutamente calmo
 * (spec 2026-11-15-sito-vetrina-wow-design.md): niente card, niente icone in
 * cerchio, niente ombre. Una griglia tipografica con un filo sopra ogni voce.
 */
export function Rest() {
  return (
    <Section id="funzioni" title={t.rest.title}>
      <ul className="mt-10 grid gap-x-10 gap-y-8 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
        {t.rest.items.map((item) => (
          <Reveal as="li" key={item.title} className="border-t border-border-2 pt-5">
            <h3 className="text-[length:var(--text-fluid-h3)] font-semibold">{item.title}</h3>
            <p className="mt-2 text-t2">{item.body}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
