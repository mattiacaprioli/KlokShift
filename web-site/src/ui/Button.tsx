import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * Ogni azione della vetrina è un link (non ci sono form): un solo componente
 * ancora, tre aspetti. L'altezza minima è 44px anche nella taglia piccola,
 * perché è la misura sotto la quale un dito sbaglia.
 */
export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
  onClick,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "quiet";
  size?: "md" | "sm";
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        "focus-gold inline-flex min-h-11 items-center justify-center gap-2 rounded-full font-medium transition-colors",
        size === "md" ? "px-6 text-base" : "px-4 text-sm",
        variant === "primary" &&
          "bg-gold text-gold-ink hover:bg-gold-light active:bg-gold-dark",
        variant === "ghost" &&
          "border border-border-2 text-t1 hover:border-border-gold hover:text-gold",
        variant === "quiet" && "text-t2 hover:text-gold",
        className
      )}
    >
      {children}
    </a>
  );
}
