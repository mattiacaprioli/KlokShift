import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * La card della vetrina. Nessuna altezza fissa: cresce col testo, così una
 * traduzione più lunga (inglese, spagnolo) non taglia niente.
 */
export function Card({
  title,
  body,
  icon,
  className,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-full rounded-2xl border border-border bg-bg-0/40 p-6 transition-colors hover:border-border-2",
        className
      )}
    >
      {icon && <div className="mb-4 text-gold">{icon}</div>}
      <h3 className="text-[length:var(--text-fluid-h3)] font-semibold">
        {title}
      </h3>
      <p className="mt-2 text-t2">{body}</p>
    </div>
  );
}
