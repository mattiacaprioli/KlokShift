import { Container } from "../ui/Container";
import { Reveal } from "../ui/Reveal";
import { t } from "../content";

/*
 * I settori come fascia sotto l'hero, al posto dei loghi dei clienti che non
 * abbiamo: dicono subito «è per te» a chi arriva. Volutamente bassa e
 * delimitata da due linee, non una sezione piena: con lo stesso sfondo e la
 * stessa spaziatura delle altre sembrava un blocco capitato lì per caso.
 */
export function Sectors() {
  return (
    <section
      id="settori"
      aria-labelledby="settori-title"
      className="border-y border-border py-8 sm:py-10"
    >
      <Container>
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2
            id="settori-title"
            className="font-mono text-xs tracking-[0.18em] text-t3 uppercase"
          >
            {t.sectors.title}
          </h2>
          <ul className="flex flex-wrap justify-center gap-2">
            {t.sectors.items.map((item) => (
              <li
                key={item}
                className="rounded-full border border-border-2 px-3.5 py-1.5 text-sm text-t2"
              >
                {item}
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
