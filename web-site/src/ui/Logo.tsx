import { cn } from "./cn";

/*
 * Il marchio in testo: "Shift" in oro è l'unico accento del logotipo.
 * L'icona vera (assets/images/icon.svg) resta per favicon e OG, dove serve
 * un'immagine.
 */
export function Logo({
  className,
  /**
   * `ink` toglie l'accento oro: sul fondo oro del menu mobile "Shift" in oro
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
      Klok<span className={tone === "gold" ? "text-gold" : undefined}>Shift</span>
    </span>
  );
}
