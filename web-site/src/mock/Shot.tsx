import type { ReactNode } from "react";
import { cn } from "../ui/cn";

/*
 * La cornice attorno a un'immagine di prodotto.
 *
 * Oggi dentro ci stanno i mockup ricostruiti in HTML (nella repo non ci sono
 * screenshot). Quando arriveranno quelli veri, basta mettere il file in
 * `public/shots/` e passare `src`: la cornice non cambia e il mock si cancella.
 *
 * Nessuna larghezza in px: la cornice prende quella del contenitore e il
 * contenuto scala in `em` a partire da `fontSize`, perché su un telefono da
 * 375px un mockup disegnato per il desktop è la prima cosa che si rompe.
 */
export function Shot({
  kind,
  alt,
  src,
  children,
  className,
}: {
  kind: "phone" | "desktop";
  alt: string;
  src?: string;
  children?: ReactNode;
  className?: string;
}) {
  const inner = src ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="block w-full"
    />
  ) : (
    // I mockup sono decorativi per chi legge con lo schermo: il testo vero
    // della sezione dice già tutto, e leggere una finta interfaccia
    // confonderebbe. L'etichetta resta nel `title` della cornice.
    <div aria-hidden="true" className="w-full">
      {children}
    </div>
  );

  if (kind === "phone") {
    return (
      <div
        title={alt}
        className={cn(
          "relative mx-auto w-full max-w-[19rem] rounded-[2rem] border border-border-2 bg-bg-card p-2 shadow-2xl shadow-black/50",
          className
        )}
      >
        <div className="absolute top-2.5 left-1/2 h-1.5 w-20 -translate-x-1/2 rounded-full bg-bg-3" />
        <div className="overflow-hidden rounded-[1.6rem] bg-bg-0 pt-6">
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div
      title={alt}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border-2 bg-bg-card shadow-2xl shadow-black/50",
        className
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-bg-3" />
      </div>
      <div className="bg-bg-0">{inner}</div>
    </div>
  );
}
