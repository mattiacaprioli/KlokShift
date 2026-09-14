import { useEffect, useRef, useState } from "react";
import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";
import { cn } from "../ui/cn";
import { t } from "../content";
import { SIGNUP_URL } from "../config";

/*
 * Barra fissa in alto. Su mobile le ancore vivono in un **overlay a tutto
 * schermo**, aperto da un cerchio che si espande dall'angolo del bottone —
 * lo stesso effetto del portfolio (`NavMobile.jsx`), riportato qui senza
 * framer-motion: sono due proprietà animate, non vale una dipendenza in più
 * su una pagina che per il resto non anima niente.
 *
 * Come funziona, in tre pezzi:
 *   1. un cerchio di 1rem fisso nell'angolo in alto a destra, che passa da
 *      `scale(0)` a `scale(180)` (≈2880px: copre qualunque telefono);
 *   2. il pannello con le voci, che entra da destra e sfuma con un ritardo,
 *      così il colore arriva prima del testo — è quel ritardo a far leggere il
 *      movimento come "il menu esce dal bottone";
 *   3. la curva `cubic-bezier(.22,1,.36,1)`, che è la lettura in CSS della
 *      molla sovrasmorzata dell'originale (stiffness 160, damping 60): parte
 *      veloce e si posa, senza rimbalzo.
 *
 * Il pannello **resta nel DOM** anche da chiuso (un `hidden` ucciderebbe le
 * transizioni): fuori dall'albero di accessibilità e dalla tabulazione ci va
 * con `inert`.
 *
 * Si chiude con la X, con `Esc` e toccando un'ancora. Mentre è aperto il body
 * non scorre (`data-menu-open`, regola in index.css) e il focus si sposta sulla
 * X, per tornare al bottone del menu alla chiusura: senza, chi naviga da
 * tastiera riparte dall'inizio del documento ogni volta.
 */
export function Nav() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Chiude il menu. `restoreFocus` è falso quando si chiude toccando un'ancora:
   * lì il salto al fragment sposta il focus per conto suo (e lo azzera al body
   * se la sezione non è focalizzabile), quindi rimetterlo sul bottone sarebbe
   * una riga che il browser cancella subito dopo.
   */
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) openerRef.current?.focus();
  };

  useEffect(() => {
    document.body.dataset.menuOpen = open ? "true" : "false";
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);

  }, [open]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg-0/85 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between gap-4">
          {/* Il logotipo è già testo: un `sr-only` col nome lo farebbe leggere
              due volte a chi usa lo screen reader. */}
          <a href="#top" className="focus-gold flex h-11 items-center rounded-lg">
            <Logo />
          </a>

          <nav
            aria-label={t.brand.name}
            className="hidden items-center gap-1 md:flex"
          >
            {t.nav.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="focus-gold rounded-full px-3 py-2 text-sm text-t2 transition-colors hover:text-gold"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* Il contenitore, non il bottone: `hidden` su un elemento che porta
                già `inline-flex` fra le sue classi di base non vincerebbe: in
                Tailwind decide l'ordine nel foglio di stile, non quello scritto
                qui. Sotto `sm` la CTA vive nella barra fissa in basso. */}
            <span className="hidden sm:block">
              <Button href={SIGNUP_URL} size="sm">
                {t.nav.cta}
              </Button>
            </span>
            <button
              ref={openerRef}
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="menu-mobile"
              aria-label={t.nav.menuLabel}
              className="focus-gold -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-t1 md:hidden"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M4 8h16M4 16h16" />
              </svg>
            </button>
          </div>
        </Container>
      </header>

      {/* Il cerchio che diventa lo sfondo del menu. Decorativo: il colore non
          porta informazione, quindi resta fuori dall'albero di accessibilità. */}
      <div
        aria-hidden="true"
        data-menu-circle
        className="pointer-events-none fixed top-0 right-0 z-60 h-4 w-4 rounded-full bg-gold-dark md:hidden"
      />

      {/* Fuori dall'header: deve coprire la pagina intera, non pendere da una
          barra alta 4rem. Il testo è scuro perché il fondo qui è l'oro. */}
      <div
        id="menu-mobile"
        inert={!open}
        // `role="dialog"` senza `aria-modal`: il body non scorre, ma il focus
        // non è intrappolato — su una pagina sola non vale la complessità.
        role="dialog"
        aria-label={t.nav.menuLabel}
        data-menu-panel
        className={cn(
          "fixed inset-y-0 z-60 flex w-full flex-col text-gold-ink md:hidden",
          open ? "right-0 opacity-100" : "-right-full opacity-0"
        )}
      >
        <Container className="flex h-16 shrink-0 items-center justify-between">
          <Logo tone="ink" />
          <button
            ref={closeRef}
            type="button"
            onClick={() => close()}
            aria-label={t.nav.closeLabel}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </Container>

        <Container className="flex flex-1 flex-col justify-center">
          <nav className="flex flex-col">
            {t.nav.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => close(false)}
                className="rounded-xl py-4 font-serif text-3xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </Container>

        <Container
          className="shrink-0 pt-4"
          // La CTA in fondo allo schermo, sopra la barra di sistema.
          style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          {/* Sul fondo oro il bottone oro sparirebbe: qui è pieno di scuro. */}
          <a
            href={SIGNUP_URL}
            onClick={() => close(false)}
            className="flex min-h-11 w-full items-center justify-center rounded-full bg-gold-ink px-6 font-medium text-gold outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 focus-visible:ring-offset-gold-dark"
          >
            {t.nav.cta}
          </a>
        </Container>
      </div>
    </>
  );
}
