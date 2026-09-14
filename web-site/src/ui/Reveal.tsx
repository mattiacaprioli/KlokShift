import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

/*
 * Ingresso in dissolvenza, senza librerie.
 *
 * L'elemento parte visibile nel markup e viene "armato" (`data-reveal`) solo
 * dentro l'effetto: se il JS non parte, o parte tardi, il contenuto resta
 * comunque leggibile invece di restare invisibile per sempre. Con
 * `prefers-reduced-motion` il CSS annulla trasformazione e transizione.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.reveal = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.dataset.in = "true";
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // Il cast serve solo perché `Tag` è un'unione di tag: il nodo è lo stesso.
      ref={ref as never}
      className={cn(className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
