import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { t } from "../content";
import { SIGNUP_URL } from "../config";

/*
 * Barra fissa in basso, solo su mobile: sul telefono la pagina è lunga e la
 * CTA della nav esce di scena dopo il primo schermo.
 *
 * Compare quando l'hero è uscito e sparisce quando arriva la CTA finale (due
 * inviti uguali nello stesso schermo sono rumore). Rispetta la safe area, così
 * su iPhone non finisce sotto la barra di sistema.
 */
export function MobileCta() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("top");
    const end = document.getElementById("inizia");
    if (!hero || !end || typeof IntersectionObserver === "undefined") return;

    let heroOut = false;
    let endIn = false;
    const sync = () => setVisible(heroOut && !endIn);

    const heroIo = new IntersectionObserver(
      ([entry]) => {
        heroOut = !entry.isIntersecting;
        sync();
      },
      { threshold: 0 }
    );
    const endIo = new IntersectionObserver(
      ([entry]) => {
        endIn = entry.isIntersecting;
        sync();
      },
      { threshold: 0 }
    );
    heroIo.observe(hero);
    endIo.observe(end);
    return () => {
      heroIo.disconnect();
      endIo.disconnect();
    };
  }, []);

  return (
    <div
      hidden={!visible}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-0/95 px-4 pt-3 backdrop-blur-md sm:hidden"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <Button href={SIGNUP_URL} className="w-full">
        {t.nav.cta}
      </Button>
    </div>
  );
}
