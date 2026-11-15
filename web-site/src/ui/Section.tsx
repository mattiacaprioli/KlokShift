import type { ReactNode } from "react";
import { Container } from "./Container";
import { Reveal } from "./Reveal";
import { cn } from "./cn";

/*
 * Una sezione della landing: ancora, sfondo alternato, intestazione.
 *
 * L'alternanza `bg-0` / `bg-card` separa le sezioni senza righe divisorie, e
 * il titolo è sempre l'elemento etichettato da `aria-labelledby`, così la
 * navigazione per landmark racconta la pagina nell'ordine giusto.
 */
export function Section({
  id,
  title,
  lead,
  tone = "base",
  children,
  headingClassName,
}: {
  id: string;
  title?: string;
  lead?: string;
  tone?: "base" | "raised";
  children?: ReactNode;
  headingClassName?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        "py-16 sm:py-24 lg:py-32",
        tone === "raised" && "bg-bg-card"
      )}
    >
      <Container>
        {(title || lead) && (
          <Reveal className="max-w-3xl">
            {title && (
              <h2
                id={headingId}
                className={cn(
                  "text-[length:var(--text-fluid-h2)] font-semibold",
                  headingClassName
                )}
              >
                {title}
              </h2>
            )}
            {lead && (
              <p className="mt-4 text-[length:var(--text-fluid-lead)] text-t2">
                {lead}
              </p>
            )}
          </Reveal>
        )}
        {children}
      </Container>
    </section>
  );
}

/** L'etichetta sopra il titolo: ormai solo nella pagina d'invito. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs tracking-[0.18em] text-gold uppercase">
      {children}
    </p>
  );
}
