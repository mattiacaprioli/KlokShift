import { cn } from "@/lib/cn";
import { useState } from "react";

/**
 * Foto profilo, con le iniziali come ripiego: un cerchio vuoto sembrerebbe
 * un'immagine che non ha finito di caricare.
 */
export function Avatar({
  url,
  name,
  size = 56,
  className,
}: {
  url: string | null | undefined;
  name: string;
  /** Lato in px: l'avatar sta in elenchi fitti e in testa a una scheda. */
  size?: number;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size };

  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onError={() => setFailedUrl(url)}
        style={style}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: Math.round(size / 3) }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-border-gold bg-gold/10 font-serif text-gold",
        className
      )}
    >
      {initials}
    </span>
  );
}
