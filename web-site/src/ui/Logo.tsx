import { cn } from "./cn";

/*
 * Il marchio in testo: la "W" in oro è l'unico accento del logotipo, come
 * nell'app. L'icona vera (assets/images/icon.svg) resta per favicon e OG,
 * dove serve un'immagine.
 */
export function Logo({
  className,
  /**
   * `ink` toglie l'accento oro: sul fondo oro del menu mobile la "W" dorata
   * sparirebbe dentro lo sfondo. Lì il marchio è tutto di un colore.
   */
  tone = "gold",
}: {
  className?: string;
  tone?: "gold" | "ink";
}) {
  return (
    <span
      className={cn(
        "font-serif text-xl leading-none font-semibold tracking-tight",
        className
      )}
    >
      top<span className={tone === "gold" ? "text-gold" : undefined}>Waitr</span>
    </span>
  );
}
