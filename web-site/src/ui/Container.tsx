import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

/*
 * L'unica misura orizzontale del sito. Il padding parte dal telefono e cresce:
 * nessun componente deve inventarsi margini propri, altrimenti le sezioni non
 * si allineano più tra loro.
 */
export function Container({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Solo per i valori che in Tailwind non esistono, come `env(safe-area-*)`. */
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}
      style={style}
    >
      {children}
    </div>
  );
}
