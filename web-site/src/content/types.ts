/*
 * La forma del copy. Serve a due cose: fa fallire `site:typecheck` se una
 * traduzione futura dimentica un pezzo, e tiene i componenti liberi da
 * stringhe (nessuna frase concatenata, nessun testo nel markup).
 */

export type Link = { href: string; label: string };
export type Feature = { title: string; body: string };
export type Faq = { q: string; a: string };

export type Content = {
  lang: string;

  brand: { name: string; tagline: string };

  nav: {
    menuLabel: string;
    closeLabel: string;
    links: Link[];
    cta: string;
  };

  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    ctaPrimary: string;
    ctaSecondary: string;
    note: string;
    shotAlt: string;
  };

  problem: {
    eyebrow: string;
    title: string;
    lead: string;
    items: Feature[];
  };

  venue: {
    eyebrow: string;
    title: string;
    lead: string;
    features: Feature[];
    shotPlanningAlt: string;
    shotHoursAlt: string;
  };

  pro: {
    eyebrow: string;
    title: string;
    lead: string;
    features: Feature[];
    shotAlt: string;
  };

  how: {
    eyebrow: string;
    title: string;
    steps: Feature[];
  };

  sectors: {
    eyebrow: string;
    title: string;
    lead: string;
    items: string[];
  };

  platforms: {
    eyebrow: string;
    title: string;
    items: Feature[];
  };

  plans: {
    eyebrow: string;
    title: string;
    lead: string;
    freeTitle: string;
    freeItems: string[];
    proTitle: string;
    proItems: string[];
    note: string;
  };

  faq: {
    eyebrow: string;
    title: string;
    items: Faq[];
  };

  finalCta: {
    title: string;
    lead: string;
    cta: string;
    secondary: string;
    note: string;
  };

  footer: {
    tagline: string;
    email: string;
    emailLabel: string;
    links: Link[];
    rights: string;
  };
};
